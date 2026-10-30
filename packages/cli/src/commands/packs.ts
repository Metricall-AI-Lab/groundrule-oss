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
    const counts = [
      ...(p.standards ? [`${p.standards} standards`] : []),
      ...(p.actions ? [`${p.actions} action ${p.actions === 1 ? "policy" : "policies"}`] : []),
    ].join(", ");
    println(io, `   ${s.bold(p.ref)} ${s.dim(`· ${counts || "empty"}`)}`);
    if (p.description) println(io, `   ${p.description}`);
    println(io);
  }
  return EXIT.ok;
}
