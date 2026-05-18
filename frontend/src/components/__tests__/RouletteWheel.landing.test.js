/**
 * Phase 6c bugfix — assert the wheel always lands cleanly inside the
 * winning segment, never on a neighbour.
 *
 * For every segment_index in 0..14 and a sweep of plausible viewport
 * widths, computeLandingOffset must place the pointer (at viewport/2)
 * strictly inside [segmentLeft + inset, segmentRight - inset].
 */
import {
    WHEEL_SIZE, SEGMENT_PX, computeLandingOffset, colorForIndex,
} from "../RouletteWheel";

const LAND_REPEAT = 22; // mirror of the private constant in RouletteWheel.jsx
const SAFE_INSET_PX = SEGMENT_PX * 0.10; // 10% from each border

describe("RouletteWheel.computeLandingOffset", () => {
    const viewports = [360, 390, 414, 640, 768, 1024, 1280, 1440];

    for (const vp of viewports) {
        for (let idx = 0; idx < WHEEL_SIZE; idx++) {
            test(`segment ${idx} at viewport ${vp}px lands inside its safe inset`, () => {
                const offset = computeLandingOffset(idx, vp, vp);
                // strip translateX is -offset; pointer (in strip coords) sits at:
                //     pointerStripX = offset + viewport/2
                const pointerStripX = offset + vp / 2;
                const targetCellLeft =
                    (LAND_REPEAT * WHEEL_SIZE + idx) * SEGMENT_PX;
                const segLeft = targetCellLeft + SAFE_INSET_PX;
                const segRight = targetCellLeft + SEGMENT_PX - SAFE_INSET_PX;
                expect(pointerStripX).toBeGreaterThanOrEqual(segLeft);
                expect(pointerStripX).toBeLessThanOrEqual(segRight);
            });
        }
    }
});

describe("RouletteWheel.colorForIndex", () => {
    test("index 0 is green", () => {
        expect(colorForIndex(0)).toBe("green");
    });
    test("odd indices are red", () => {
        for (const i of [1, 3, 5, 7, 9, 11, 13]) {
            expect(colorForIndex(i)).toBe("red");
        }
    });
    test("non-zero even indices are black", () => {
        for (const i of [2, 4, 6, 8, 10, 12, 14]) {
            expect(colorForIndex(i)).toBe("black");
        }
    });
});
