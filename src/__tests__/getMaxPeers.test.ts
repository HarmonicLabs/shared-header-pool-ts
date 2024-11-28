import { getMaxPeers } from "../HeaderPoolReader";
import { HeaderPoolSize } from "../types/SupportedHeaderPoolSize";

describe("getMaxPeers", () => {

    test("64 kb", () => {
        expect( getMaxPeers( 512, HeaderPoolSize.kb64 ) ).toBe( 120 );
    });
    test("32 kb", () => {
        expect( getMaxPeers( 512, HeaderPoolSize.kb32 ) ).toBe( 60 );
    });

});