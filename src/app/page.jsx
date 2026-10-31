import Link from "next/link";
import { AccountControls } from "@/components/account-provider";
import { ThemeToggle } from "@/components/theme-provider";
export default function HomePage() {
  return (
    <div data-page="home">
      <div className="theme-home">
        <ThemeToggle />
      </div>
      <main>
        <span className="eyebrow">AWS CERTIFICATION</span>
        <h1>SAA-C03 학습 자료</h1>
        <p>AWS Certified Solutions Architect · Associate</p>
        <AccountControls />
        <nav aria-label="학습 자료">
          <Link href="/concepts/">
            <h2>개념 위키 →</h2>
            <p>핵심 개념을 찾아보고, 연결된 문제로 복습하세요.</p>
          </Link>
          <Link href="/dumps/">
            <h2>문제집 →</h2>
            <p>684문제를 풀고 정답과 해설을 확인하세요.</p>
          </Link>
        </nav>
        <p className="note">
          로그인하면 풀이 기록을 계정에 저장하고 다른 기기에서 이어서 풀 수
          있습니다. 로그인 없이도 현재 기기와 브라우저에 저장하며 이용할 수
          있습니다.
        </p>
      </main>
    </div>
  );
}
