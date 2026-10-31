import { notFound } from "next/navigation";
import { conceptRoutes, conceptDocument } from "@/lib/concepts";
import { StudyHeader } from "@/components/study-header";
import { ConceptContent } from "@/components/concept-content";
import { ConceptNavigation } from "@/components/concept-navigation";
export const dynamicParams = false;
export function generateStaticParams() {
  return conceptRoutes();
}
export async function generateMetadata({ params }) {
  const doc = await conceptDocument((await params).slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}
export default async function Page({ params }) {
  const doc = await conceptDocument((await params).slug);
  if (!doc) notFound();
  return (
    <div data-page="concepts">
      <a className="skip-link" href="#main">
        본문으로 이동
      </a>
      <StudyHeader page="concepts" quiz={doc.key.startsWith("/quiz/")} />
      <ConceptNavigation documentKey={doc.key}>
        <ConceptContent html={doc.main} documentKey={doc.key} />
      </ConceptNavigation>
      <footer className="footer">
        <div className="footer-inner">
          <span>SAA-C03 개념 위키 · 공식 문서 확인 2026.09.30</span>
          <a
            href="https://docs.aws.amazon.com/aws-certification/latest/solutions-architect-associate-03/solutions-architect-associate-03.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            AWS 시험 가이드 ↗
          </a>
        </div>
      </footer>
    </div>
  );
}
