import Container from './Container';

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
