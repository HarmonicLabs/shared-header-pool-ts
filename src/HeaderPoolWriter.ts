import { HeaderPoolWriteResult } from "./types/HeaderPoolWriteResult";
import { isSupportedHeaderPoolSize } from "./types/SupportedHeaderPoolSize";
import { HeaderPoolConfig } from "./HeaderPoolConfig";
import { HASH_SIZE, N_HEADERS_I32_IDX, PERFORMING_DROP, TIP_BLOCK_NO_I32_IDX, WRITING_PEERS_I32_IDX } from "./constants";
import { uint8ArrayEq } from "@harmoniclabs/uint8array-utils";
import { unwrapWaitAsyncResult } from "./utils/unwrapWaitAsyncResult";

type VoidCb = () => void;

export interface HeaderPoolWriterEvents {
    free: VoidCb[];
}

export type HeaderPoolWriterEventName = keyof HeaderPoolWriterEvents;

export type HeaderPoolWriterEventCb = HeaderPoolWriterEvents[HeaderPoolWriterEventName][number];

export class HeaderPoolWriter
{
    // private readonly sharedMemory: SharedArrayBuffer;
    private readonly int32View: Int32Array;
    private readonly u32View: Uint32Array;
    // private readonly indexes: Uint32Array;
    // private readonly hashes: Uint32Array;
    private readonly u8View: Uint8Array;
    readonly config: HeaderPoolConfig;

    private readonly _onceEvents: HeaderPoolWriterEvents = Object.freeze({
        free: []
    });

    private readonly _onEvents: HeaderPoolWriterEvents = Object.freeze({
        free: []
    });
    
    constructor(
        sharedMemory: SharedArrayBuffer,
        config: HeaderPoolConfig
    )
    {
        if (!(typeof globalThis.SharedArrayBuffer !== "undefined")) throw new Error("SharedArrayBuffer not supported, cannot create HeaderPoolWriter");

        const size = sharedMemory.byteLength;
        if( !isSupportedHeaderPoolSize( size ) ) throw new Error(`Invalid HeaderPoolWriter size: ${size}`);

        // this.sharedMemory = sharedMemory;
        this.int32View = new Int32Array( sharedMemory );
        this.u32View = new Uint32Array( sharedMemory );
        // this.indexes = new Uint32Array( sharedMemory, N_MUTEX_BYTES, maxTxs - 1 );
        // this.hashes = new Uint32Array( sharedMemory, startHashesU8, maxTxs * (HASH_SIZE / 4) );
        this.u8View = new Uint8Array( sharedMemory );

        this.config = Object.freeze({
            ...config,
        });

        this._subHeaderNo();
    }

    readBlockNo(): number
    {
        return Atomics.load( this.u32View, TIP_BLOCK_NO_I32_IDX );
    }

    private async __subHeaderNo(): Promise<"ok" | "not-equal" | "timed-out">
    {
        return unwrapWaitAsyncResult(
            Atomics.waitAsync(
                this.int32View,
                N_HEADERS_I32_IDX,
                /// @ts-ignore error TS2345: Argument of type 'number' is not assignable to parameter of type 'bigint'.
                Atomics.load( this.int32View, N_HEADERS_I32_IDX ),
            )
        )
    }

    private _subHeaderNo(): void
    {
        this.__subHeaderNo()
        .then( res => {
            this._subHeaderNo();
            if( res === "ok" ) this.dispatchEvent( "free" );
        });
    }

    async write( hash: Uint8Array, header: Uint8Array ): Promise<HeaderPoolWriteResult>
    {
        {// init promise scope
            const initPromise = this._makeSureNoDrop();
            if(!(
                hash instanceof Uint8Array &&
                hash.length === HASH_SIZE &&
                header instanceof Uint8Array &&
                header.length <= this.config.maxHeaderSize
            )) return HeaderPoolWriteResult.Invalid;
            await initPromise;
        }
        this._incrementWritingPeers();

        const nHeaders = this._readNHeaders();
        if( nHeaders >= this.config.maxPeers )
        {
            this._decrementWritingPeers();
            return HeaderPoolWriteResult.InsufficientSpace;
        }
        if( this._isHashPresent( hash, nHeaders ) )
        {
            this._decrementWritingPeers();
            return HeaderPoolWriteResult.Duplicate;
        }

        // increments nHeaders
        const idx = this._getWriteIndex();

        this.u8View.set( hash, this.config.startHashesU8 + (idx * HASH_SIZE) );
        this.u8View.set( header, this.config.startHeadersU8 + (idx * this.config.maxHeaderSize) );
        this._signalWrite();

        this._decrementWritingPeers();
        return HeaderPoolWriteResult.Ok;
    }

    private _signalWrite(): void
    {
        Atomics.notify( this.int32View, TIP_BLOCK_NO_I32_IDX );
    }

    private _isHashPresent( hash: Uint8Array, nHeaders: number ): boolean
    {
        for( let i = 0; i < nHeaders; )
        {
            if(
                uint8ArrayEq(
                    hash,
                    this.u8View.subarray(
                        this.config.startHashesU8 + (i * HASH_SIZE),
                        this.config.startHashesU8 + ((++i) * HASH_SIZE)
                    )
                )
            ) return true
        }
        return false;
    }

    private _makeSureNoDrop(): void | Promise<void>
    {
        // not-equal there was no drop;
        // timed-out means it took too long;
        // ok means there was a drop and it ended;
        const { async, value } = Atomics.waitAsync(
            this.int32View,
            0,
            PERFORMING_DROP as any,
            3000 // 3 seconds timeout
            // (`drop` might wait 1 seconds for reading peers to finish)
        );
        if( async ) return value as unknown as Promise<void>;
        return;
    }

    private _readNHeaders(): number
    {
        return Atomics.load( this.u32View, N_HEADERS_I32_IDX );
    }

    private _getWriteIndex(): number
    {
        // `Atomic.add` returns the value previous to the addition
        return Atomics.add( this.u32View, N_HEADERS_I32_IDX, 1 );
    }

    /**
     * UNSAFE
     * ONLY CALL AFTER AWAITING `_makeSureNoDrop`
     */
    private _incrementWritingPeers(): void
    {
        Atomics.add( this.u32View, WRITING_PEERS_I32_IDX, 1 );
    }

    private _decrementWritingPeers(): void
    {
        const prev = Atomics.sub( this.u32View, WRITING_PEERS_I32_IDX, 1 );
        if( prev <= 1 )
        {
            Atomics.notify( this.int32View, WRITING_PEERS_I32_IDX );
        }
    }

    dispatchEvent( name: HeaderPoolWriterEventName ): void
    {
        // one-time
        let listeners = this._onceEvents[name];
        if( !Array.isArray( listeners ) ) return;

        for( const cb of listeners ) cb();
        listeners.length = 0;
        // persisting
        listeners = this._onEvents[name];
        for( const cb of listeners ) cb();
    }

    on( name: HeaderPoolWriterEventName, cb: HeaderPoolWriterEventCb ): void
    {
        this._onEvents[name]?.push( cb );
    }

    once( name: HeaderPoolWriterEventName, cb: HeaderPoolWriterEventCb ): void
    {
        this._onceEvents[name]?.push( cb );
    }

    off( name: HeaderPoolWriterEventName, cb: HeaderPoolWriterEventCb ): void
    {
        let listeners = this._onEvents[name];
        if( !Array.isArray( listeners ) ) return;

        let idx = listeners.indexOf( cb );
        if( idx !== -1 ) listeners.splice( idx, 1 );

        listeners = this._onceEvents[name];
        idx = listeners.indexOf( cb );
        if( idx !== -1 ) listeners.splice( idx, 1 );
    }

}