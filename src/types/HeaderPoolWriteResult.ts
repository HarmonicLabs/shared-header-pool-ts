
export enum HeaderPoolWriteResult {
    Ok = 0,
    Invalid = 1,
    InsufficientSpace = 2,
    Duplicate = 3,
}

Object.freeze( HeaderPoolWriteResult );