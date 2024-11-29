// first 4 bytes mutex
export const PERFORMING_DROP = 0;
export const NOT_PERFORMING_DROP = 1;

export const N_MUTEX_BYTES = 16;
export const N_MUTEX_I32 = Math.ceil( N_MUTEX_BYTES / 4 ) as 4;

// 3rd 4 bytes
export const N_HEADERS_I32_IDX = 2

// 4th 4 bytes
export const TIP_BLOCK_NO_I32_IDX = 3;

export const PERFORMING_DROP_I32_IDX = 0;
export const WRITING_PEERS_I32_IDX = 1;

export const HASH_SIZE = 32;