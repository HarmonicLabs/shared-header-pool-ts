
export enum HeaderPoolSize {
    kb8 = 8192,
    kb16 = 16384,
    kb32 = 32768,
    kb64 = 65536,
}

Object.freeze( HeaderPoolSize );

export type SupportedHeaderPoolSize
    = 8192      // 8KB (16 peers @ 512 maxHeaderSize)
    | 16384     // 16KB (32 peers @ 512 maxHeaderSize)
    | 32768     // 32KB (64 peers @ 512 maxHeaderSize)
    | 65536     // 64KB (128 peers @ 512 maxHeaderSize)


export function isSupportedHeaderPoolSize(value: any): value is SupportedHeaderPoolSize
{
    return (
        value === 8192      ||
        value === 16384     ||
        value === 32768     ||
        value === 65536
    );
}

export function getOptimalSize( desiredPeers: number, maxHeaderSize: number ): HeaderPoolSize
{
    const desiredSize = desiredPeers * maxHeaderSize;
    // if( desiredSize >= HeaderPoolSize.kb128 ) return HeaderPoolSize.kb128;
    // if( desiredSize > HeaderPoolSize.kb64 ) return HeaderPoolSize.kb128;
    if( desiredSize > HeaderPoolSize.kb32 ) return HeaderPoolSize.kb64;
    if( desiredSize > HeaderPoolSize.kb16 ) return HeaderPoolSize.kb32;
    if( desiredSize > HeaderPoolSize.kb8 ) return HeaderPoolSize.kb16;
    return HeaderPoolSize.kb8;
}

export function getMaxPeersAllowed( headersAllocatedSize: number, maxHeaderSize: number ): number
{
    // https://stackoverflow.com/a/7488075
    // All bitwise operations except unsigned right shift, >>>, work on signed 32-bit integers.
    // So using bitwise operations will convert a float to an integer.
    return (headersAllocatedSize / maxHeaderSize) | 0;
}