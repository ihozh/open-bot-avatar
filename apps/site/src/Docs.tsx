import { parse, render } from "sugar-high/core";
import * as typescript from "sugar-high/lang/typescript";
import * as shell from "sugar-high/lang/shell";
import * as json from "sugar-high/lang/json";
import { examples } from "open-bot-avatar";
import { GALLERY } from "./gallery";
import { defaultColor } from "./studio/look";
import { BotAvatar } from "./BotAvatar";
import { REPO } from "./route";

const INSTALL = `pnpm add open-bot-avatar`;

const USAGE = `import { getExample } from "open-bot-avatar";
import { mountAvatar } from "open-bot-avatar/dom";

const avatar = mountAvatar(document.querySelector("#bot")!, {
  definition: getExample("mug")!,
  color: "#ff6a1a",
  followPointer: true,
});

avatar.update({ mood: "happy" });
avatar.destroy();`;

const REACT_USAGE = `import { useEffect, useRef } from "react";
import { mountAvatar, type AvatarOptions, type MountedAvatar } from "open-bot-avatar/dom";

export function BotAvatar({ size = 96, ...options }: AvatarOptions & { size?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);
  useEffect(() => {
    avatar.current = mountAvatar(host.current!, options);
    return () => avatar.current?.destroy();
  }, []);
  useEffect(() => avatar.current?.update(options));
  return <div ref={host} style={{ width: size, aspectRatio: "1" }} />;
}`;

const STILL_USAGE = `import { avatarFrame, renderAvatarSvg, validateAvatar } from "open-bot-avatar";

const result = validateAvatar(JSON.parse(json));
if (result.ok) {
  const svg = renderAvatarSvg(result.value, { color: "#1fbf68", size: 256 });
  const frame = avatarFrame(result.value, { color: "#1fbf68" });
}`;

const DEFINITION = `{
  "version": 1,
  "id": "box",
  "name": "Box",
  "body": { "path": "M20 20 H80 V80 H20 Z" },
  "eyes": { "x": 50, "y": 46, "spacing": 15, "scale": 1 }
}`;

const languages = { typescript, shell, json };
// These examples are constant; tokenize once when the Docs module loads.
const snippets = {
  install: render(parse(INSTALL, languages.shell)),
  usage: render(parse(USAGE, languages.typescript)),
  react: render(parse(REACT_USAGE, languages.typescript)),
  still: render(parse(STILL_USAGE, languages.typescript)),
  definition: render(parse(DEFINITION, languages.json)),
};

function Code({ snippet, language }: { snippet: keyof typeof snippets; language: string }) {
  return (
    <pre className="code" tabIndex={0} aria-label={`${language} example`}>
      <code dangerouslySetInnerHTML={{ __html: snippets[snippet] }} />
    </pre>
  );
}

const PROPS: [string, string][] = [
  ["definition", "The avatar. Required."],
  ["color, eyeColor", "#rgb, #rrggbb or any CSS color. Default: #ff6a1a and #151515."],
  ["mood", '"idle" (default), "thinking" or "happy".'],
  ["followPointer", "Look at the mouse or finger. Default: false."],
  ["lookAt", "A fixed look direction, { x, y } from -1 to 1. Wins over the pointer."],
  ["holdGaze", "Keep looking where it looks now. Default: false."],
  ["view", "Extra rotation, { yaw, pitch } in radians."],
  ["depth", "Volume, 0 (flat) to 14. Default: 6."],
  ["reducedMotion", 'true, false or "system" (default).'],
  ["still", "One static SVG, no animation. Default: false."],
  ["renderer", '"canvas" (default) or "scene", a CSS 3D scene: more CPU, less video memory for one large avatar.'],
  ["label", 'Accessible name. Default: the definition\'s name; "" for decorative.'],
];

/** A random starter or gallery avatar in its own color, picked once per page load. */
const ALL = [...examples, ...GALLERY];
const PICK = ALL[Math.floor(Math.random() * ALL.length)];

export function Docs() {
  return (
    <main className="page docs">
      <section className="page-head">
        <BotAvatar className="avatar-view docs-avatar" definition={PICK} color={defaultColor(PICK.id)} followPointer label="" />
        <h1>Docs</h1>
        <p className="lead">A JSON spec and renderer for interactive agent avatars.</p>
        <ul className="lead what">
          <li>Spec: one SVG path, and where the eyes sit.</li>
          <li>
            Renderer: the <code>open-bot-avatar</code> package, with no dependencies.
          </li>
          <li>
            <a href="#/">Editor</a>: pick, color, generate and import avatars.
          </li>
        </ul>
        <p className="lead">Open source, MIT licensed.</p>
      </section>

      <h2>Make an avatar</h2>
      <p>
        In the <a href="#/">editor</a>, describe it under Generate, send the prompt to any chat model or agent, and paste the JSON it{" "}
        returns into Import.
      </p>

      <h2>Definition</h2>
      <p>
        One path in a <code>0 0 100 100</code> box, and the eyes: their center, spacing and scale. Check any definition you didn't{" "}
        write with <code>validateAvatar</code>. The rules are in the{" "}
        <a href={`${REPO}/blob/main/docs/avatar-contract.md`}>contract</a>. Version 2 adds an optional <code>parts</code> array that
        moves each outline subpath in depth (<code>z</code>) and tilts it (<code>pitch</code>, <code>yaw</code> about a <code>pivot</code>);
        without it a v2 definition renders exactly like v1.
      </p>
      <Code snippet="definition" language="JSON" />

      <h2>Install</h2>
      <Code snippet="install" language="Shell" />

      <h2>Mount an avatar</h2>
      <p>
        <code>mountAvatar</code> fills a square element with a live avatar. <code>update</code> changes options,{" "}
        <code>destroy</code> removes it.
      </p>
      <Code snippet="usage" language="TypeScript" />
      <table className="props">
        <caption>Options</caption>
        <tbody>
          {PROPS.map(([name, text]) => (
            <tr key={name}>
              <th scope="row"><code>{name}</code></th>
              <td>{text}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>SVG</h2>
      <p>
        <code>renderAvatarSvg</code> returns an SVG string, with no DOM needed. <code>avatarFrame</code> returns the same frame as{" "}
        data, for drawing it yourself.
      </p>
      <Code snippet="still" language="TypeScript" />

      <h2>React</h2>
      <p>There's no React package; this component is all you need. Other frameworks work the same way.</p>
      <Code snippet="react" language="TSX" />
    </main>
  );
}
