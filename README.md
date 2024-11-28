# shared-header-pool-ts

Here you find a typescript implementation for a shared pool of headers necessary for the ouroboros consensus implementation in typescript.

## design differences from mempool

The design is inspired by the [`shared-cardano-mempool-ts`](https://github.com/HarmonicLabs/shared-cardano-mempool-ts), with some key differences.

Two different classes are allowed to access the shared memory: 

1) a "reader" that only reads and consumes the headers, that will be used by the only thread performing chain selection
2) a "writer" class, used by many threads for each upstream peer, that only appends new headers

## low level differences

unlike transactions, we can expect the largest possible header to be relatively small, so we can use the max size as a fixed size to store headers.

by consequence we don't have to remember the position of every header, we just need to know how many headers we have.

other consequence is that the drop operation is now oorders of magnitude simpler, we just read the data and then set the "number of headers" to 0,
so that new headers will override the old ones.
There is no need to move other heders or anything else so complex, we drop all the stored headers at once.