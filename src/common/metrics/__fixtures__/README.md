# Fixtures

Raw device output, committed so every parser can be exercised without hardware.
Each device directory holds the same five files:

| File | Source on the device |
| --- | --- |
| `proc-stat.txt` | `cat /proc/stat` |
| `proc-meminfo.txt` | `cat /proc/meminfo` |
| `dumpsys-battery.txt` | `dumpsys battery` |
| `dumpsys-thermalservice.txt` | `dumpsys thermalservice` |
| `cpufreq.json` | `cat /sys/devices/system/cpu/cpuN/cpufreq/scaling_cur_freq`, one entry per core, in core order |

`cpufreq.json` is a JSON array rather than a copied shell transcript: the
per-core reads are separate shell calls, and storing them as an array keeps the
core boundary visible instead of losing it in line breaks.

## Provenance

| Directory | Status |
| --- | --- |
| `mtk-tb8781p4` | **Real capture**, taken straight from the device. MediaTek MT8781 (`vext_tb8781p4_64_wifi`, `ro.hardware=mt8781`, arm64-v8a, Android 17 / SDK 37), 8 cores. |
| `mtk-sysfs-reference` | **Synthesised, not captured.** The thermal zone globs, the `power_supply` node and the two `devfreq` nodes are written to the shapes those files have on MediaTek hardware. On the reference device above every one of them is permission-denied to the shell user, so none of these could be captured with `adb shell`; they exist to pin the parsers, not to prove what a device reports. The DDR sample treats the `mtk-dvfsrc` DVFS-resource node as the memory clock, which is an inference and not a measured fact. |
| `ums9370-sysfs-reference` | **Real capture**, taken from the device. Spreadtrum/Unisoc UMS9370 (`ro.board.platform=ums9370`): the `scene-frequency` devfreq node, which drives the DDR clock through `sprd-governor` and publishes it already in MHz rather than Hz; plus the `dumpsys thermalservice` dump and the sysfs thermal zones, whose names carry a `-thmzone` suffix (`soc-thmzone`, `gpu-thmzone`, …) and whose CPU-type zone is named `soc-thmzone` rather than `CPU`. |
| `qcom-reference` | **Synthesised, not captured.** Shaped after a Qualcomm dump (`AC powered`, `current now`, `POWER_AMPLIFIER` / `BCL_VOLTAGE` zones) so the parsers are not only exercised against MediaTek output. Replace it with a real capture as soon as a Qualcomm device is on hand. |

## Adding a device

Capture the five files above into a new directory and add one row to the table
in `devices.test.ts`. No parser changes should be needed; if one is, that is
the signal the parsers over-fit a single platform.