# Fixtures

Device property maps, committed so the platform classifier can be exercised
without hardware. Each file is the subset of `adb shell getprop` / adbkit
`getProperties()` output the classifier reads, plus a few neighbouring keys for
realism.

## Provenance

| File | Status |
| --- | --- |
| `getprop-mtk.json` | **Reference, not captured.** Shaped after a MediaTek MT8781 device (`ro.hardware=mt8781`, the same device the metrics fixtures document as a real capture). Replace with a real `getprop` capture as soon as one is on hand. |
| `getprop-unisoc.json` | **Reference, not captured.** Shaped after a UNISOC UMS9230 device. Replace with a real capture. |
| `getprop-unknown.json` | **Reference, not captured.** Shaped after a Qualcomm `kona` device so the classifier is also exercised against a non-MTK, non-UNISOC platform. Replace with a real capture. |

## Adding a device

Drop a new `<name>.json` property map and add one case row to
`platform.test.ts`. No classifier changes should be needed; if one is, that is
the signal the classifier over-fits a single platform.
