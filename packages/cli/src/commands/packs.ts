import { listPacks } from "@groundrule/packs";
import { EXIT, type IO, println, style } from "../io.js";

export async function packs(io: IO): Promise<number> {
  const s = style(io);
  println(io);
  println(
    io,
    ` ${s.bold("Bundled packs")} ${s.dim("· add to extends in .groundrule/config.yaml")}`,
  );
  println(io);
  for (const p of await listPacks()) {
    println(io, `   ${s.bold(p.ref)} ${s.dim(`· ${p.standards} standards`)}`);
    if (p.description) println(io, `   ${p.description}`);
    println(io);
  }
  return EXIT.ok;
}
