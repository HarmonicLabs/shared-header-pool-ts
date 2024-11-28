import { HeaderPoolWriteResult } from "./types/HeaderPoolWriteResult";
import { isSupportedHeaderPoolSize } from "./types/SupportedHeaderPoolSize";
import { HeaderPoolConfig } from "./HeaderPoolConfig";
import { HASH_SIZE, N_HEADERS_I32_IDX, PERFORMING_DROP, WRITING_PEERS_I32_IDX } from "./constants";
import { uint8ArrayEq } from "@harmoniclabs/uint8array-utils";

export class HeaderPoolWriter
{
    // private readonly sharedMemory: SharedArrayBuffer;
    private readonly int32View: Int32Array;
    private readonly u32View: Uint32Array;
    // private readonly indexes: Uint32Array;
    // private readonly hashes: Uint32Array;
    private readonly u8View: Uint8Array;
    readonly config: HeaderPoolConfig;

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

        this._decrementWritingPeers();
        return HeaderPoolWriteResult.Ok;
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
}