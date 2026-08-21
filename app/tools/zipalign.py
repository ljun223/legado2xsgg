#!/usr/bin/env python3
"""Minimal zipalign replacement: rewrite an APK so every entry's data starts
at an aligned offset (default 4 bytes). Original entry bytes, compression and
metadata are copied verbatim; alignment padding goes into the local header
extra field.
Usage: zipalign.py <in.apk> <out.apk> [alignment]"""
import struct
import sys
import zipfile


def dos_time(dt):
    return (dt[3] << 11) | (dt[4] << 5) | (dt[5] // 2)


def dos_date(dt):
    return ((dt[0] - 1980) << 9) | (dt[1] << 5) | dt[2]


def align_apk(src, dst, alignment=4):
    zin = zipfile.ZipFile(src, "r")
    f = open(src, "rb")
    out = open(dst, "wb")
    offset = 0
    central = []

    for info in zin.infolist():
        # read the original raw entry bytes (compressed) verbatim
        data_start = info.header_offset + 30 + len(info.filename) + len(info.extra)
        f.seek(data_start)
        raw = f.read(info.compress_size)
        name = info.filename.encode("utf-8")

        data_off = offset + 30 + len(name)
        pad = (alignment - (data_off % alignment)) % alignment
        extra = b"\x00" * pad

        # Real sizes are written into the local header, so the data
        # descriptor bit (0x08) must be cleared (no descriptor follows).
        flags = info.flag_bits & ~0x08
        t, d = dos_time(info.date_time), dos_date(info.date_time)
        out.write(struct.pack(
            "<IHHHHHIIIHH", 0x04034B50, info.create_version, flags,
            info.compress_type, t, d, info.CRC, info.compress_size,
            info.file_size, len(name), len(extra)))
        out.write(name)
        out.write(extra)
        out.write(raw)

        central.append((name, info, t, d, offset, len(extra)))
        offset = data_off + len(extra) + len(raw)

    cd_start = offset
    for name, info, t, d, lho, _elen in central:
        # Central-directory extra is left empty (the alignment padding lives
        # only in the local header), matching the real zipalign behaviour.
        out.write(struct.pack(
            "<IHHHHHHIIIHHHHHII", 0x02014B50,
            20, info.create_version, flags, info.compress_type, t, d,
            info.CRC, info.compress_size, info.file_size, len(name), 0, 0,
            0, 0, 0, lho))
        out.write(name)
        offset += 46 + len(name)
    cd_size = offset - cd_start

    out.write(struct.pack(
        "<IHHHHIIH", 0x06054B50, 0, 0, len(central), len(central),
        cd_size, cd_start, 0))
    out.close()
    f.close()
    zin.close()


def check_alignment(apk, alignment=4):
    zin = zipfile.ZipFile(apk, "r")
    ok = True
    for info in zin.infolist():
        # read the local header's own extra length (the alignment padding)
        with open(apk, "rb") as f:
            f.seek(info.header_offset)
            hdr = f.read(30)
            if len(hdr) == 30:
                fields = struct.unpack("<IHHHHHIIIHH", hdr)
                local_elen = fields[10]
            else:
                local_elen = 0
        data_off = info.header_offset + 30 + len(info.filename.encode("utf-8"))
        data_off += local_elen
        if data_off % alignment:
            print("MISALIGNED: %s (data at %d)" % (info.filename, data_off))
            ok = False
    return ok


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    align = int(sys.argv[4]) if len(sys.argv) > 4 else 4
    align_apk(sys.argv[1], sys.argv[2], align)
    print("aligned: %s -> %s (alignment=%d)" % (sys.argv[1], sys.argv[2], align))
    sys.exit(0 if check_alignment(sys.argv[2], align) else 2)
