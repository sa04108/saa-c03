export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function exportJSON(state) {
  download(
    new Blob(
      [
        JSON.stringify(
          { ...state, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    `saa-c03-progress-${new Date().toISOString().slice(0, 10)}.json`,
  );
}
export async function exportHTML(state) {
  let template;
  if (document.getElementById("offline-root")) {
    const copy = document.documentElement.cloneNode(true);
    copy.querySelector("#offline-root").replaceChildren();
    copy.querySelector("#saved-progress").textContent = JSON.stringify(
      state,
    ).replace(/</g, "\\u003c");
    template = "<!doctype html>\n" + copy.outerHTML;
  } else {
    const response = await fetch("/offline/dumps.html");
    if (!response.ok) throw Error("Backup unavailable");
    template = (await response.text()).replace(
      '<script id="saved-progress" type="application/json">null</script>',
      () =>
        '<script id="saved-progress" type="application/json">' +
        JSON.stringify(state).replace(/</g, "\\u003c") +
        "</script>",
    );
  }
  download(
    new Blob([template], { type: "text/html;charset=utf-8" }),
    "SAA-C03-study-progress.html",
  );
}
