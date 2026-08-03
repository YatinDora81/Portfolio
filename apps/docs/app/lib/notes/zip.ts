import { deflateRawSync } from "node:zlib";

/**
 * A zip writer, in one file, with no dependency.
 *
 * Node gives us raw DEFLATE and nothing else, so what is left is the container:
 * a local header in front of every entry, a central directory listing them all
 * again at the end, and an end-of-central-directory record pointing at that
 * list. All three carry sizes and a CRC-32, and all three have to agree.
 *
 * That agreement is the whole risk. Most extractors stream the local headers
 * and never look at the central directory; Windows Explorer and macOS Archive
 * Utility read the central directory first. A wrong CRC or a size copied into
 * one place and not the other therefore produces an archive that opens
 * perfectly in `unzip` and fails in Finder, or the reverse — which is why
 * zip.test.ts hands the bytes to a real extractor rather than trusting that the
 * numbers look plausible.
 *
 * Deliberately not implemented: Zip64, encryption, and directory entries. The
 * first two are not needed for a personal vault; the third is optional by spec
 * whenever every entry name carries its full path, which ours do.
 */

export interface ZipEntry {
  /** Full path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: string;
}

/* ----------------------------------------------------------------- CRC-32 -- */

/** The standard reversed polynomial, 0xEDB88320. Built once, lazily. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------- DOS time -- */

/**
 * MS-DOS date/time, the only timestamp a base zip record has room for: two
 * seconds of resolution and an epoch of 1980. A record of all zeroes means
 * month 0 and day 0, which some tools flag as corrupt, so a real clamped
 * timestamp is written even for dates that predate the format.
 */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/* ------------------------------------------------------------------- zip -- */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Bit 11: filenames and comments are UTF-8. Without it an extractor is
 *  entitled to read the name as CP437, and every non-ASCII note title
 *  arrives as mojibake on the platforms that actually honour the flag. */
const FLAG_UTF8 = 0x0800;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/** 2.0 — the version that introduced DEFLATE, which is all this writer uses. */
const VERSION = 20;

/**
 * Host system 3 (Unix) in the high byte of "version made by".
 *
 * Not cosmetic. Info-ZIP's `unzip` — the one macOS ships, built without
 * UNICODE_SUPPORT — reads a FAT/MS-DOS host as licence to treat the filename as
 * CP437 and transcode it, which turns every UTF-8 note title into mojibake and
 * then fails to create the directory at all. Declaring Unix stops the
 * translation and the bytes are taken as written. It is also what makes the
 * external attributes below mean anything.
 */
const MADE_BY = (3 << 8) | VERSION;

/** 0o100644 in the high half, where a Unix host keeps st_mode. Without it the
 *  extracted files inherit whatever the extractor invents, which on some tools
 *  is mode 000. */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

export function zipSync(entries: ZipEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosStamp(at);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    // Leading slashes make an entry look absolute; several extractors refuse
    // the archive outright rather than guess where such a file should land.
    const name = Buffer.from(entry.name.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    const raw = Buffer.from(entry.data, "utf8");
    const deflated = deflateRawSync(raw);

    // DEFLATE has a floor of a few bytes of framing, so a very short file comes
    // out larger than it went in. Storing those keeps the archive honest about
    // being smaller than its contents.
    const stored = deflated.length >= raw.length;
    const payload = stored ? raw : deflated;
    const method = stored ? METHOD_STORE : METHOD_DEFLATE;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(MADE_BY, 4);
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(EXTERNAL_ATTRS, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk holding the directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16); // the directory starts where the entries stop
  eocd.writeUInt16LE(0, 20); // archive comment

  return Buffer.concat([...locals, directory, eocd]);
}
