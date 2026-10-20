"""Exercise the static site under the same /saa-c03/ prefix as GitHub Pages."""

import functools
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PROGRESS_KEY = "saa-c03-684-20260926-v1:progress"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_directory = tempfile.TemporaryDirectory()
        cls.server_root = Path(cls.server_directory.name)
        (cls.server_root / "saa-c03").symlink_to(ROOT, target_is_directory=True)
        handler = functools.partial(QuietHandler, directory=cls.server_directory.name)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f"http://127.0.0.1:{cls.server.server_port}"
        cls.base = cls.origin + "/saa-c03"
        cls.playwright = sync_playwright().start()
        html = (ROOT / "dumps/index.html").read_text()
        cls.bank = json.loads(re.search(
            r'<script id="bank-data" type="application/json">(.*?)</script>',
            html, re.S,
        ).group(1))

    @classmethod
    def tearDownClass(cls):
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.server_directory.cleanup()

    def setUp(self):
        self.profile_directory = tempfile.TemporaryDirectory()
        self.errors = []
        self.api_requests = []
        self.launch_profile()

    def launch_profile(self, name="browser"):
        executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium")
        self.context = self.playwright.chromium.launch_persistent_context(
            str(Path(self.profile_directory.name) / name),
            executable_path=executable,
            headless=True,
            args=["--no-sandbox"],
            viewport={"width": 1280, "height": 900},
            accept_downloads=True,
        )
        self.context.on("page", self.observe_page)
        self.context.on("request", lambda request: self.api_requests.append(request.url)
                        if "/api/" in request.url else None)
        self.page = self.context.pages[0]
        self.observe_page(self.page)

    def observe_page(self, page):
        page.on("pageerror", lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()
        self.profile_directory.cleanup()
        self.assertEqual(self.errors, [], "Browser JavaScript errors")
        self.assertEqual(self.api_requests, [], "Static pages must not call a server API")

    def open_dumps(self, page=None):
        page = page or self.page
        page.goto(self.base + "/dumps/")
        expect(page.locator("#loading")).to_be_hidden()
        expect(page.locator("#question-title")).to_be_visible()

    def answer_first_question(self):
        for answer in self.bank["questions"][0]["answer"]:
            self.page.locator(f'[data-option="{answer}"]').click()
        self.page.locator("#check").click()
        expect(self.page.locator(".result-title")).to_have_text("정답입니다.")

    def jump(self, number):
        self.page.locator("#jump").fill(str(number))
        self.page.locator('#jump-form button[type="submit"]').click()
        expect(self.page.locator("#question-title")).to_have_text(f"문제 {number:03d}")

    def test_paths_cross_navigation_and_concepts_search(self):
        self.page.goto(self.base + "/")
        self.page.get_by_role("link", name="개념 위키 →").click()
        self.assertEqual(self.page.url, self.base + "/concepts/")
        self.assertEqual(self.page.locator(".dictionary-item").count(), 62)
        search = self.page.locator("#term-search")
        search.fill("CloudFront")
        self.assertGreater(self.page.locator(".dictionary-item:visible").count(), 0)
        self.assertLess(self.page.locator(".dictionary-item:visible").count(), 62)
        search.fill("no-such-aws-service-123456")
        expect(self.page.locator("#no-results")).to_be_visible()
        search.fill("")
        self.page.locator('a[href="#/terms/cloudfront.html"]').first.click()
        expect(self.page.locator("#main h1")).to_contain_text("CloudFront")
        self.page.locator(".study-link").click()
        self.assertEqual(self.page.url, self.base + "/dumps/")
        expect(self.page.locator("#loading")).to_be_hidden()
        self.page.locator(".wiki-link").click()
        self.assertEqual(self.page.url, self.base + "/concepts/")
        self.page.goto(self.base + "/concepts")
        self.assertEqual(self.page.url, self.base + "/concepts/")
        self.page.goto(self.base + "/dumps")
        self.assertEqual(self.page.url, self.base + "/dumps/")

    def test_answers_flags_drafts_and_position_survive_browser_restart(self):
        self.open_dumps()
        self.answer_first_question()
        self.page.locator("#flag").click()
        self.page.locator("#next").click()
        self.page.locator('[data-option="A"]').click()
        expect(self.page.locator("#save-status")).to_have_text("자동저장 완료")
        self.context.close()
        self.launch_profile()
        self.open_dumps()
        expect(self.page.locator("#question-title")).to_have_text("문제 002")
        expect(self.page.locator('[data-option="A"]')).to_have_attribute("aria-pressed", "true")
        expect(self.page.locator("#check")).to_be_visible()
        expect(self.page.locator("#done")).to_have_text("1")
        self.page.locator("#prev").click()
        expect(self.page.locator("#flag")).to_have_attribute("aria-pressed", "true")
        expect(self.page.locator(".result-title")).to_have_text("정답입니다.")
        # A separate browser profile has its own records.
        self.context.close()
        self.launch_profile("another-device")
        self.open_dumps()
        expect(self.page.locator("#done")).to_have_text("0")
        expect(self.page.locator("#question-title")).to_have_text("문제 001")

    def test_filters_and_search_survive_reload(self):
        self.open_dumps()
        self.page.locator("#flag").click()
        self.page.locator("#filter").select_option("flagged")
        query = self.bank["questions"][0]["stem"].split()[0]
        self.page.locator("#search").fill(query)
        # Wait for the debounced search to reach durable storage.
        self.page.wait_for_function("([key, query]) => JSON.parse(localStorage.getItem(key)).query === query",
                                    arg=[PROGRESS_KEY, query])
        self.page.reload()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#filter")).to_have_value("flagged")
        expect(self.page.locator("#search")).to_have_value(query)
        self.assertEqual(self.page.locator("#navigator button").count(), 1)

    def test_indexeddb_recovers_when_localstorage_is_unavailable(self):
        self.context.add_init_script("Object.defineProperty(window, 'localStorage', {get() {throw new DOMException('Blocked', 'SecurityError')}})")
        self.open_dumps()
        self.answer_first_question()
        self.page.locator("#flag").click()
        expect(self.page.locator("#save-status")).to_have_text("자동저장 완료")
        self.page.reload()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#done")).to_have_text("1")
        expect(self.page.locator("#flag")).to_have_attribute("aria-pressed", "true")
        expect(self.page.locator(".result-title")).to_have_text("정답입니다.")

    def test_localstorage_works_when_indexeddb_is_unavailable(self):
        self.context.add_init_script("Object.defineProperty(window, 'indexedDB', {get() {throw new DOMException('Blocked', 'SecurityError')}})")
        self.open_dumps()
        self.answer_first_question()
        self.page.reload()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#done")).to_have_text("1")
        expect(self.page.locator("#save-status")).to_have_text("자동저장 완료")

    def test_blocked_storage_warns_and_still_allows_backup(self):
        self.context.add_init_script("""
            for (const name of ['localStorage', 'indexedDB']) {
                Object.defineProperty(window, name, {get() {throw new DOMException('Blocked', 'SecurityError')}});
            }
        """)
        self.open_dumps()
        self.answer_first_question()
        expect(self.page.locator("#save-status")).to_have_text("저장 불가 · 백업 필요")
        expect(self.page.locator("#storage-warning")).to_be_visible()
        self.page.locator("#open-settings").click()
        with self.page.expect_download() as downloaded:
            self.page.locator("#export-json").click()
        backup = json.loads(Path(downloaded.value.path()).read_text())
        self.assertTrue(backup["records"]["1"]["checked"])

    def test_tabs_merge_progress_and_reset_does_not_restore_old_answers(self):
        self.open_dumps()
        other = self.context.new_page()
        self.open_dumps(other)
        self.answer_first_question()
        expect(other.locator("#done")).to_have_text("1")
        other.locator("#flag").click()
        expect(self.page.locator("#flag")).to_have_attribute("aria-pressed", "true")
        self.page.locator("#open-settings").click()
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#reset").click()
        expect(self.page.locator("#done")).to_have_text("0")
        expect(other.locator("#done")).to_have_text("0")
        expect(other.locator("#flag")).to_have_attribute("aria-pressed", "false")
        self.page.reload()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#done")).to_have_text("0")

    def test_json_and_standalone_html_backup_round_trip(self):
        self.open_dumps()
        self.answer_first_question()
        self.page.locator("#flag").click()
        self.jump(315)
        self.page.locator("#open-settings").click()
        json_path = Path(self.profile_directory.name) / "progress.json"
        with self.page.expect_download() as downloaded:
            self.page.locator("#export-json").click()
        downloaded.value.save_as(json_path)
        with self.page.expect_download() as downloaded:
            self.page.locator("#export-html").click()
        html_path = self.server_root / "saved-progress.html"
        downloaded.value.save_as(html_path)
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#reset").click()
        expect(self.page.locator("#done")).to_have_text("0")
        self.page.locator("#open-settings").click()
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#import-json").set_input_files(json_path)
        expect(self.page.locator("#settings")).not_to_be_visible()
        expect(self.page.locator("#question-title")).to_have_text("문제 315")
        expect(self.page.locator("#done")).to_have_text("1")
        self.context.close()
        self.launch_profile("offline-backup")
        # Serve the downloaded document with fresh storage and no dependencies.
        # Managed Chromium can block file:// navigation through browser policy.
        self.context.route("**/*", lambda route: route.continue_()
                           if route.request.url == self.origin + "/saved-progress.html"
                           else route.abort())
        self.page.goto(self.origin + "/saved-progress.html")
        self.context.set_offline(True)
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#question-title")).to_have_text("문제 315")
        expect(self.page.locator("#done")).to_have_text("1")
        expect(self.page.locator("#settings")).not_to_be_visible()
        self.page.locator("#open-settings").click()
        expect(self.page.locator("#export-html")).to_be_enabled()
        html_path.unlink()

    def test_mobile_navigation_and_multiselect(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        self.open_dumps()
        self.assertLessEqual(self.page.evaluate("document.documentElement.scrollWidth"), 390)
        self.page.locator("#toggle-map").click()
        self.assertEqual(self.page.locator("#toggle-map").get_attribute("aria-expanded"), "true")
        question = next(q for q in self.bank["questions"] if q["count"] > 1 and q["answer"])
        self.jump(question["id"])
        expect(self.page.locator("#check")).to_be_disabled()
        for answer in question["answer"]:
            self.page.locator(f'[data-option="{answer}"]').click()
        self.page.locator("#check").click()
        expect(self.page.locator(".result-title")).to_have_text("정답입니다.")
        self.page.locator("#retry").click()
        expect(self.page.locator("#check")).to_be_disabled()


if __name__ == "__main__":
    unittest.main()
