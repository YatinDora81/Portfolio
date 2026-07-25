import Container from './Container';

/**
 * Bridge — the divider between the Hero and About sections.
 *
 * A hairline "wire" strung across the column with a tiny ASCII cat sitting on
 * it. Purely decorative, so the whole thing is aria-hidden: it carries no
 * information a screen reader would miss.
 *
 * The cat only appears while `body.cat-on` is set (CatProvider mirrors its
 * `showCat` state onto the body). Shoo the cat with the navbar paw and it hops
 * off the wire too, leaving a plain interpunct — see the `#bridge` rules in
 * globals.css. Nothing here is stateful, so it stays a server component.
 */
export default function Bridge() {
  return (
    <div id="bridge" aria-hidden="true">
      <Container>
        <div className="cw mono">
          <span className="cat">=^..^=</span>
          <span className="dot">&middot;</span>
        </div>
      </Container>
    </div>
  );
}
