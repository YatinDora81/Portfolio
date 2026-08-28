import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { crc32, zipSync } from "./zip";

const AT = new Date(2026, 7, 3, 14, 30, 20);

const LOCAL_SIG = "504b0304";
const CENTRAL_SIG = "504b0102";
const EOCD_SIG = "504b0506";

const sigAt = (buf: Buffer, offset: number) => buf.subarray(offset, offset + 4).toString("hex");

function readCentral(buf: Buffer) {
  const eocd = buf.length - 22;
  const count = buf.readUInt16LE(eocd + 10);
  const size = buf.readUInt32LE(eocd + 12);
  const start = buf.readUInt32LE(eocd + 16);

  const entries: {
    name: string;
    flags: number;
    method: number;
    crc: number;
    csize: number;
    usize: number;
    localOffset: number;
  }[] = [];

  let p = start;
  for (let i = 0; i < count; i++) {
    expect(sigAt(buf, p)).toBe(CENTRAL_SIG);
    const nameLen = buf.readUInt16LE(p + 28);
    entries.push({
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
      name: buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"),
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  expect(p - start).toBe(size);
  return entries;
}

function readPayload(buf: Buffer, localOffset: number): Buffer {
  expect(sigAt(buf, localOffset)).toBe(LOCAL_SIG);
  const method = buf.readUInt16LE(localOffset + 8);
  const csize = buf.readUInt32LE(localOffset + 18);
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const at = localOffset + 30 + nameLen + extraLen;
  const raw = buf.subarray(at, at + csize);
  return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
}

describe("crc32", () => {
  test("matches the standard check vectors", () => {
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog", "utf8"))).toBe(0x414fa339);
    expect(crc32(Buffer.from("a", "utf8"))).toBe(0xe8b7be43);
    expect(crc32(Buffer.from("", "utf8"))).toBe(0);
  });

  test("is computed over bytes, not characters", () => {
    expect(crc32(Buffer.from("🙂", "utf8"))).toBe(crc32(new Uint8Array([0xf0, 0x9f, 0x99, 0x82])));
  });
});

describe("zipSync structure", () => {
  const entries = [
    { name: "dsa/graphs/dijkstra.md", data: "# Dijkstra\n\n".repeat(40) },
    { name: "hi.md", data: "hi" },
    { name: "图论/思考.md", data: "# 思考\n\n非 ASCII の名前\n" },
  ];
  const buf = zipSync(entries, AT);

  test("opens with a local file header and ends with an EOCD record", () => {
    expect(sigAt(buf, 0)).toBe(LOCAL_SIG);
    expect(sigAt(buf, buf.length - 22)).toBe(EOCD_SIG);
    expect(buf.readUInt16LE(buf.length - 2)).toBe(0); // no archive comment
  });

  test("the EOCD counts every entry and points at the directory it describes", () => {
    const eocd = buf.length - 22;
    expect(buf.readUInt16LE(eocd + 8)).toBe(entries.length);
    expect(buf.readUInt16LE(eocd + 10)).toBe(entries.length);
    expect(sigAt(buf, buf.readUInt32LE(eocd + 16))).toBe(CENTRAL_SIG);
  });

  test("names, CRCs and both sizes agree between the two headers and the data", () => {
    const central = readCentral(buf);
    expect(central.map((e) => e.name)).toEqual(entries.map((e) => e.name));

    for (const [i, e] of central.entries()) {
      const source = Buffer.from(entries[i]!.data, "utf8");
      expect(e.crc).toBe(crc32(source));
      expect(e.usize).toBe(source.length);

      const local = e.localOffset;
      expect(buf.readUInt32LE(local + 14)).toBe(e.crc);
      expect(buf.readUInt32LE(local + 18)).toBe(e.csize);
      expect(buf.readUInt32LE(local + 22)).toBe(e.usize);
      expect(buf.readUInt16LE(local + 8)).toBe(e.method);

      expect(readPayload(buf, local).toString("utf8")).toBe(entries[i]!.data);
    }
  });

  test("the UTF-8 name flag is set in both headers, so 图论 is not mojibake", () => {
    for (const e of readCentral(buf)) {
      expect(e.flags & 0x0800).toBe(0x0800);
      expect(buf.readUInt16LE(e.localOffset + 6) & 0x0800).toBe(0x0800);
    }
  });

  test("stores what deflate would make bigger, deflates what it shrinks", () => {
    const [repeated, tiny] = readCentral(buf);
    expect(repeated!.method).toBe(8);
    expect(repeated!.csize).toBeLessThan(repeated!.usize);
    expect(tiny!.method).toBe(0);
    expect(tiny!.csize).toBe(tiny!.usize);
  });

  test("a leading slash is stripped so no entry looks absolute", () => {
    const [entry] = readCentral(zipSync([{ name: "/a/b.md", data: "x" }], AT));
    expect(entry!.name).toBe("a/b.md");
  });

  test("the DOS stamp is a real date, not a zeroed field", () => {
    const [entry] = readCentral(buf);
    const date = buf.readUInt16LE(entry!.localOffset + 12);
    expect((date >> 5) & 0x0f).toBe(8); // month, 1-based
    expect(date & 0x1f).toBe(3); // day
    expect(date >> 9).toBe(2026 - 1980);
  });

  test("an empty archive is still a valid one", () => {
    const empty = zipSync([], AT);
    expect(empty.length).toBe(22);
    expect(sigAt(empty, 0)).toBe(EOCD_SIG);
    expect(empty.readUInt16LE(10)).toBe(0);
  });
});

const UNZIP = spawnSync("unzip", ["-v"], { encoding: "utf8" }).status === 0;
if (!UNZIP) {
  console.warn("[zip.test] `unzip` not on PATH — the real-extractor assertions are SKIPPED, not passing.");
}

const dir = UNZIP ? mkdtempSync(join(tmpdir(), "notes-zip-")) : "";
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("zipSync against a real extractor", () => {
  test.skipIf(!UNZIP)("`unzip -t` accepts the archive and every CRC in it", () => {
    const file = join(dir, "vault.zip");
    writeFileSync(
      file,
      zipSync(
        [
          { name: "vault.json", data: JSON.stringify({ nodes: [] }) },
          { name: "dsa/graphs/dijkstra.md", data: "# Dijkstra\n\nGreedy over a min-heap.\n".repeat(20) },
          { name: "图论/思考.md", data: "# 思考\n" },
          { name: "edge/empty.md", data: "" },
        ],
        AT,
      ),
    );

    const t = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
    expect(t.stderr).toBe("");
    expect(t.stdout).toContain("No errors detected");
    expect(t.status).toBe(0);
  });

  test.skipIf(!UNZIP)("extracted bytes match what went in, non-ASCII names included", () => {
    const body = "# 思考\n\nline\twith a tab and a \"quote\"\n";
    const file = join(dir, "one.zip");
    writeFileSync(file, zipSync([{ name: "图论/思考.md", data: body }], AT));

    const p = spawnSync("unzip", ["-p", file, "图论/思考.md"], { encoding: "buffer" });
    expect(p.status).toBe(0);
    expect(p.stdout.toString("utf8")).toBe(body);
  });
});
