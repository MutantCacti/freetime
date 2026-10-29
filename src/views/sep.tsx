/**
 * A line whose parts are separated by " · ", with each "·" in the subtle
 * separator colour. The text read aloud is unchanged.
 */
export function WithSeps({ text }: { text: string }) {
  const parts = text.split(" · ");
  return (
    <>
      {parts.map((part, i) => (
        <>
          {i > 0 ? (
            <>
              {" "}
              <span class="sep">·</span>{" "}
            </>
          ) : null}
          {part}
        </>
      ))}
    </>
  );
}
