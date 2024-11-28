import { SupportedHeaderPoolSize } from "./types/SupportedHeaderPoolSize";

export interface HeaderPoolReaderMemArgs {
    desiredPeers: number;
    maxHeaderSize: number;
}

export interface HeaderPoolReaderArgs extends HeaderPoolReaderMemArgs {}

export const defaultConfig: HeaderPoolReaderArgs = Object.freeze({
    desiredPeers: 20,
    maxHeaderSize: 512
});

export interface HeaderPoolConfig extends HeaderPoolReaderArgs
{
    readonly desiredPeers: number,
    readonly maxHeaderSize: number,

    readonly size: SupportedHeaderPoolSize,
    readonly maxPeers: number,
    readonly allHashesSize: number
    readonly startHashesU8: number,
    readonly startHeadersU8: number,
}