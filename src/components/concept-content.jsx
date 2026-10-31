import parse, { domToReact, attributesToProps } from "html-react-parser";
import Link from "next/link";
import { ConceptQuiz } from "./concept-quiz";
import { AIButton } from "./assistant/ai-button";
const cls = (node, name) => node.attribs?.class?.split(" ").includes(name);
const find = (node, predicate) =>
  (node.children || [])
    .flatMap((child) => [child, ...find(child, predicate)])
    .filter(predicate);
export function ConceptContent({ html, documentKey }) {
  const options = {
    replace(node) {
      if (node.type !== "tag") return;
      const children = () => domToReact(node.children, options);
      if (node.name === "a" && node.attribs.href?.startsWith("/concepts/"))
        return <Link {...attributesToProps(node.attribs)}>{children()}</Link>;
      if (cls(node, "article-header"))
        return (
          <header
            {...attributesToProps(node.attribs)}
            className={`${node.attribs.class} saa-ai-context`}
          >
            {children()}
            <AIButton context={{ source: "concept", key: documentKey }} />
          </header>
        );
      if (cls(node, "question-card") && node.attribs["data-question"]) {
        const one = (predicate) => find(node, predicate)[0];
        const content = (item) =>
          item ? domToReact(item.children, options) : null;
        const number = one((n) => cls(n, "question-no")),
          type = one((n) => cls(n, "type-label"));
        const explanation = one((n) => cls(n, "explanation"));
        return (
          <ConceptQuiz
            key={`${node.attribs["data-question"]}:${node.attribs["data-revision"] || 1}`}
            id={node.attribs["data-question"]}
            revision={Number(node.attribs["data-revision"] || 1)}
            correct={node.attribs["data-correct"]}
            number={content(number)}
            type={content(type)}
            question={content(one((n) => n.name === "h3"))}
            options={find(node, (n) => cls(n, "option")).map((label) =>
              content(label.children.find((n) => n.attribs?.lang === "en")),
            )}
            explanation={domToReact(
              explanation.children.filter((n) => n.name !== "summary"),
              options,
            )}
            tags={domToReact(
              [one((n) => cls(n, "question-tags"))].filter(Boolean),
              options,
            )}
            link={domToReact(
              [one((n) => cls(n, "question-link"))].filter(Boolean),
              options,
            )}
          />
        );
      }
    },
  };
  return parse(html, options);
}
