import { unwrapWaitAsyncResult } from "./utils/unwrapWaitAsyncResult";
import { getMaxPeersAllowed, getOptimalSize, isSupportedHeaderPoolSize } from "./types/SupportedHeaderPoolSize";
import { HeaderPoolConfig, HeaderPoolReaderMemArgs, HeaderPoolReaderArgs, defaultConfig } from "./HeaderPoolConfig";
import { HASH_SIZE, N_HEADERS_I32_IDX, N_MUTEX_BYTES, NOT_PERFORMING_DROP, PERFORMING_DROP, WRITING_PEERS_I32_IDX } from "./constants";

/**
 * given the number of peers and the full buffer size, returns the size allocated to the actual headers
 */
function getHeaderHashesAllocatedSize( nPeers: number ): number
{
    return HASH_SIZE * nPeers;
}
/**
 * given the number of peers and the full buffer size, returns the size allocated to the actual headers
 */
function getHeadersAllocatedSize( nPeers: number, size: number ): number
{
    return size - (N_MUTEX_BYTES + getHeaderHashesAllocatedSize(nPeers));
}

export function getMaxPeers( maxHeaderSize: number, fullSize: number ): number
{
    const maxPeers = getMaxPeersAllowed( fullSize, maxHeaderSize );
    const headersSizeOnMax = getHeadersAllocatedSize( maxPeers, fullSize );
    const minPeers = getMaxPeersAllowed( headersSizeOnMax, maxHeaderSize );

    const peerAllocation = HASH_SIZE + maxHeaderSize;

    function getRequiredSpaceForPeers( nPeers: number ): number
    {
        return (nPeers * peerAllocation) + N_MUTEX_BYTES;
    }

    let nPeers = minPeers;
    while( getRequiredSpaceForPeers( nPeers ) <= fullSize ) nPeers++;
    return nPeers - 1;
}

/**
```ts
[
    PERFORMING_DROP_mutex,                              // 4 bytes ( only i32 allows `Atomics.notify` and `Atomics.waitAsync` )
    writing_peers_count,                                // 4 bytes ( `Atomics.notify` and `Atomics.waitAsync` on 0 )
    append_queque,                                      // 4 bytes ( `Atomics.notify` and `Atomics.waitAsync` one at the time )
    // tx_count ( 1 byte ) | aviable_space ( 3 bytes )  // 4 bytes, also `APPEND_INFO_BYTES`
    tx_count | aviable_space,     

    // end of mutex bytes (N_MUTEX_BYTES)

    // length inferred by writing the following index
    // last index length is inferred by `(size - startIndex) - aviableSpace`
    // the first tx index is always `startHeadersU8` so we don't store it
    ...indexes,         // 4 bytes each, 4 * (maxTxs - 1) total
    ...hashes,          // 32 bytes each, 32 * maxTxs total
    ...txs,             // variable size, up to `size - startHeadersU8`
]
```
*/

export class HeaderPoolReader
{
    readonly sharedMemory: SharedArrayBuffer;
    private readonly bi64View: BigUint64Array;
    private readonly int32View: Int32Array;
    private readonly u32View: Uint32Array;
    // private readonly indexes: Uint32Array;
    // private readonly hashes: Uint32Array;
    private readonly u8View: Uint8Array;
    readonly config: HeaderPoolConfig;

    static getIntializedMemory( desiredSize: HeaderPoolReaderMemArgs): SharedArrayBuffer
    static getIntializedMemory( args: HeaderPoolReaderMemArgs): SharedArrayBuffer
    static getIntializedMemory( thing: HeaderPoolReaderMemArgs | number): SharedArrayBuffer
    {
        const size = typeof thing === "number" ? thing : getOptimalSize(
            thing.desiredPeers ?? defaultConfig.desiredPeers,
            thing.maxHeaderSize ?? defaultConfig.maxHeaderSize
        );

        const buff = new SharedArrayBuffer( size );

        const view = new Uint32Array( buff );
        view.fill( 0 );

        Atomics.store( view, 0, NOT_PERFORMING_DROP );
        Atomics.store( view, 1, 0 );
        Atomics.store( view, 2, 0 );
        // Atomics.store( view, 3, 0 );

        return buff;
    }

    getWriterArgs(): [ sharedMemory: SharedArrayBuffer, config: HeaderPoolReaderArgs ]
    {
        return [ this.sharedMemory, this.config ];
    }

    constructor(
        config: HeaderPoolReaderArgs = defaultConfig,
        sharedMemory: SharedArrayBuffer = HeaderPoolReader.getIntializedMemory( config )
    )
    {
        if (!(typeof globalThis.SharedArrayBuffer !== "undefined")) throw new Error("SharedArrayBuffer not supported, cannot create HeaderPoolReader");

        const size = sharedMemory.byteLength;
        if( !isSupportedHeaderPoolSize( size ) ) throw new Error(`Invalid HeaderPoolReader size: ${size}`);

        const maxPeers = getMaxPeers( config.maxHeaderSize, size );

        // const startIndexes = N_MUTEX_BYTES;
        const startHashesU8 = N_MUTEX_BYTES;
        const startHeadersU8 = startHashesU8 + ( maxPeers * HASH_SIZE );

        /*
        ...hashes,          // 32 bytes each, 32 * maxTxs total
        ...txs,             // variable size, up to `size - startHeadersU8`
        */

        this.sharedMemory = sharedMemory;
        this.bi64View = new BigUint64Array( sharedMemory );
        this.int32View = new Int32Array( sharedMemory );
        this.u32View = new Uint32Array( sharedMemory );
        // this.indexes = new Uint32Array( sharedMemory, N_MUTEX_BYTES, maxTxs - 1 );
        // this.hashes = new Uint32Array( sharedMemory, startHashesU8, maxTxs * (HASH_SIZE / 4) );
        this.u8View = new Uint8Array( sharedMemory );

        this.config = Object.freeze({
            ...defaultConfig,
            ...config,
            size,
            maxPeers,
            allHashesSize: maxPeers * HASH_SIZE,
            startHashesU8,
            startHeadersU8
        });
    }

    private async _cloneMem(): Promise<Uint8Array>
    {
        Atomics.store( this.int32View, 0, PERFORMING_DROP );
        await this._makeSureNoWritingPeers();

        const buff = new ArrayBuffer( this.sharedMemory.byteLength );
        const u8 = new Uint8Array( buff );
        u8.set( this.u8View );

        // clear headers
        Atomics.store( this.int32View, N_HEADERS_I32_IDX, 0 );

        // notify all waiting peers
        Atomics.store( this.int32View, 0, NOT_PERFORMING_DROP );
        Atomics.notify( this.int32View, 0 );

        return u8;
    }

    async getHeaders(): Promise<Uint8Array[]>
    {
        const mem = await this._cloneMem();
        let offset = this.config.startHeadersU8;
        const u32View = new Uint32Array( mem.buffer );

        const nHeades = u32View[N_HEADERS_I32_IDX];
        const arr = new Array<Uint8Array>( nHeades );

        const maxHeaderSize = this.config.maxHeaderSize;

        for( let i = 0; i < nHeades; i++ )
        {
            arr[i] = mem.slice( offset, offset + maxHeaderSize );
            offset += maxHeaderSize;
        }

        return arr;
    }

    private _unsafe_read(): ArrayBuffer
    {
        const buff = new ArrayBuffer( length );
        const u8 = new Uint8Array( buff );
        u8.set( this.u8View);
        return buff;
    }

    private async _makeSureNoWritingPeers(): Promise<void>
    {
        let currentWritingPeers = this._getWritingPeers();
        let value: "ok" | "not-equal" | "timed-out" = "not-equal";
        while( currentWritingPeers !== 0 )
        {
            value = await unwrapWaitAsyncResult(
                Atomics.waitAsync(
                    this.int32View,
                    WRITING_PEERS_I32_IDX,
                    currentWritingPeers as any,
                    1000 // 1 second timeout
                )
            );

            switch( value )
            {
                // only edge case we care about
                // not-equal means we need to recheck the writing peers count
                // since it changed since we read and it might be 0 now
                case "not-equal":
                    currentWritingPeers = this._getWritingPeers();
                    break;
                // ok means noone is writing
                case "ok":
                // timed-out means it took too long
                // and we proceed anyway
                case "timed-out":
                default:
                    return;
            }
        }
    }

    private _getWritingPeers(): number
    {
        return Atomics.load( this.int32View, WRITING_PEERS_I32_IDX );
    }
}