"""Browser integration with a deterministic Auth/DB adapter, not live OAuth."""
import json
import base64
import time
from pathlib import Path

from playwright.sync_api import expect
import test_site


A = "11111111-1111-4111-8111-111111111111"
B = "22222222-2222-4222-8222-222222222222"
BANK = "saa-c03-684-20260926-v1"
GUEST_KEY = BANK + ":progress"

SDK = """
(() => {
 const user = JSON.parse(localStorage.getItem('saa-test-user') || 'null');
 const callbacks = [];
 function request(body) {
   return fetch(new URL('__test__/progress', location.href), {
     method: 'POST', headers: {'Content-Type':'application/json'}, body:JSON.stringify(body)
   }).then(response => response.json());
 }
 window.supabase = {createClient: () => ({
   auth: {
     getSession: async () => ({data:{session:user ? {user} : null},error:null}),
     onAuthStateChange: callback => {callbacks.push(callback);},
     signInWithOAuth: async options => {localStorage.setItem('saa-test-oauth',JSON.stringify(options)); return {data:{},error:null};},
     signOut: async () => {localStorage.setItem('saa-test-user','null'); for(const callback of callbacks)callback('SIGNED_OUT',null); return {error:null};}
   },
   from: () => {
     const filters = {};
     const query = {select: () => query, eq: (key,value) => {filters[key]=value;return query;},
       maybeSingle: () => request({kind:'load',...filters})};
     return query;
   },
   rpc: (_name,body) => request({kind:'save',...body})
 })};
})();
"""


class AccountTests(test_site.SiteFixture):
    def setUp(self):
        super().setUp()
        self.remote = {}
        self.calls = []
        self.configure()

    def configure(self, user_id=A):
        user = {"id": user_id, "user_metadata": {"user_name": "learner"}} if user_id else None
        self.context.add_init_script("""
            try {
                if (localStorage.getItem('saa-test-user') === null) {
                    localStorage.setItem('saa-test-user', %s);
                }
            } catch (_) {}
        """ % json.dumps(json.dumps(user)))
        self.context.route("**/assets/account-config.js", lambda route: route.fulfill(
            content_type="text/javascript", body="window.SAA_ACCOUNT_CONFIG={supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'sb_publishable_test'};"))
        self.context.route("**/assets/vendor/supabase.js", lambda route: route.fulfill(content_type="text/javascript", body=SDK))
        self.context.route("**/__test__/progress", self.api)

    def api(self, route):
        body = route.request.post_data_json
        self.calls.append(body)
        if body["kind"] == "load":
            value = self.remote.get(body["user_id"])
            route.fulfill(json={"data": value, "error": None})
            return
        user_id = body["p_user_id"]
        previous = self.remote.get(user_id) or {"revision": 0, "state": None}
        if body["p_expected_revision"] != previous["revision"]:
            route.fulfill(json={"data": {**previous, "conflict": True}, "error": None})
        else:
            value = {"revision": previous["revision"] + 1, "state": body["p_state"]}
            self.remote[user_id] = value
            route.fulfill(json={"data": {**value, "conflict": False}, "error": None})

    def saved(self):
        expect(self.page.locator("#save-status")).to_have_text("계정 저장 완료")

    def test_landing_button_starts_github_oauth_with_the_site_redirect(self):
        self.context.close()
        self.launch_profile("signed-out")
        self.configure(None)
        self.page.goto(self.base + "/")
        button = self.page.get_by_role("button", name="GitHub로 로그인")
        expect(button).to_be_enabled()
        button.click()
        options = self.page.evaluate("JSON.parse(localStorage.getItem('saa-test-oauth'))")
        self.assertEqual(options, {"provider": "github", "options": {"redirectTo": self.base + "/"}})

    def test_vendored_supabase_sdk_loads_a_session_and_sends_authenticated_progress(self):
        self.context.unroute("**/assets/vendor/supabase.js")
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
        expires = int(time.time()) + 3600
        token = encode({"alg": "HS256", "typ": "JWT"}) + "." + encode({"sub": A, "aud": "authenticated", "role": "authenticated", "exp": expires}) + ".test-signature"
        user = {"id": A, "aud": "authenticated", "role": "authenticated", "email": "learner@example.test", "app_metadata": {"provider": "github"}, "user_metadata": {"user_name": "learner"}}
        session = {"access_token": token, "refresh_token": "test-refresh", "expires_at": expires, "expires_in": 3600, "token_type": "bearer", "user": user}
        self.context.add_init_script("try { localStorage.setItem('saa-c03-github-auth', %s); } catch (_) {}" % json.dumps(json.dumps(session)))
        authorization = []
        def supabase_api(route):
            authorization.append(route.request.headers.get("authorization"))
            if "/auth/v1/user" in route.request.url:
                route.fulfill(json=user)
            elif "/rpc/save_study_progress" in route.request.url:
                body = route.request.post_data_json
                self.assertEqual(body["p_user_id"], A)
                value = {"revision": body["p_expected_revision"] + 1, "state": body["p_state"]}
                self.remote[A] = value
                route.fulfill(json={**value, "conflict": False})
            elif "/rest/v1/study_progress" in route.request.url:
                route.fulfill(json=[self.remote[A]] if A in self.remote else [])
            else:
                route.fulfill(status=400, json={"message": "Unexpected test request"})
        self.context.route("https://test.supabase.co/**", supabase_api)
        self.open_dumps()
        self.answer_first_question()
        self.saved()
        self.assertTrue(self.remote[A]["state"]["records"]["1"]["checked"])
        self.assertTrue(authorization)
        self.assertTrue(all(value == "Bearer " + token for value in authorization))

    def test_progress_follows_the_account_across_devices_and_not_other_accounts(self):
        self.open_dumps()
        self.answer_first_question()
        self.page.locator("#flag").click()
        self.saved()
        self.context.close()
        self.launch_profile("another-device")
        self.configure(A)
        self.open_dumps()
        expect(self.page.locator("#done")).to_have_text("1")
        expect(self.page.locator("#flag")).to_have_attribute("aria-pressed", "true")
        self.page.goto(self.base + "/")
        expect(self.page.locator("[data-account-progress]")).to_have_text("계정에 저장된 풀이: 1 / 684문제")
        self.page.evaluate("id => localStorage.setItem('saa-test-user', JSON.stringify({id,user_metadata:{user_name:'other'}}))", B)
        self.open_dumps()
        expect(self.page.locator("#done")).to_have_text("0")
        expect(self.page.locator("#flag")).to_have_attribute("aria-pressed", "false")
        self.assertTrue(self.remote[A]["state"]["records"]["1"]["checked"])

    def test_guest_progress_is_imported_only_after_the_user_chooses_it(self):
        guest = {"version": 1, "bank": BANK, "current": 1, "updatedAt": 1, "filter": "all", "query": "",
                 "records": {"1": {"selected": self.bank["questions"][0]["answer"], "checked": True, "flagged": True, "updatedAt": 1}}}
        self.context.add_init_script("localStorage.setItem(%s,%s)" % (json.dumps(GUEST_KEY), json.dumps(json.dumps(guest))))
        self.open_dumps()
        expect(self.page.locator("#done")).to_have_text("0")
        self.page.locator("#open-settings").click()
        expect(self.page.locator("#import-guest")).to_be_visible()
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#import-guest").click()
        self.saved()
        expect(self.page.locator("#done")).to_have_text("1")
        self.assertTrue(self.remote[A]["state"]["records"]["1"]["checked"])
        self.assertEqual(self.page.evaluate("key => JSON.parse(localStorage.getItem(key))", GUEST_KEY), guest)

    def test_a_stale_device_preserves_server_progress_and_requires_explicit_resolution(self):
        self.open_dumps()
        self.remote[A] = {"revision": 1, "state": {"version": 1, "bank": BANK, "current": 2, "updatedAt": 5, "filter": "all", "query": "", "records": {}}}
        self.answer_first_question()
        expect(self.page.locator("#account-warning")).to_be_visible()
        expect(self.page.locator("#save-status")).to_have_text("다른 기기의 기록 확인 필요")
        self.assertEqual(self.remote[A]["state"]["current"], 2)
        self.page.reload()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.locator("#save-status")).to_have_text("다른 기기의 기록 확인 필요")
        self.page.once("dialog", lambda dialog: dialog.accept())
        self.page.locator("#load-account-progress").click()
        expect(self.page.locator("#question-title")).to_have_text("문제 002")
        expect(self.page.locator("#done")).to_have_text("0")
        self.assertEqual(self.remote[A]["revision"], 1)

    def test_a_second_editing_tab_does_not_overwrite_the_pending_device_cache(self):
        self.open_dumps()
        other = self.context.new_page()
        other.goto(self.base + "/dumps/")
        expect(other.locator("#loading-message")).to_contain_text("다른 문제집 탭")
        self.page.close()
        other.get_by_role("button", name="다시 시도").click()
        expect(other.locator("#loading")).to_be_hidden()

    def test_logout_returns_to_guest_progress_without_exposing_the_account(self):
        self.open_dumps()
        self.answer_first_question()
        self.saved()
        self.page.get_by_role("button", name="로그아웃").click()
        expect(self.page.locator("#loading")).to_be_hidden()
        expect(self.page.get_by_role("button", name="GitHub로 로그인")).to_be_visible()
        expect(self.page.locator("#done")).to_have_text("0")
        self.assertEqual(self.remote[A]["state"]["records"]["1"]["checked"], True)

    def test_account_html_backup_contains_progress_without_authentication_assets(self):
        self.open_dumps()
        self.answer_first_question()
        self.saved()
        self.page.locator("#open-settings").click()
        with self.page.expect_download() as downloaded:
            self.page.locator("#export-html").click()
        text = Path(downloaded.value.path()).read_text()
        self.assertNotIn('src="../assets/account', text)
        self.assertNotIn('src="../assets/vendor/supabase', text)
        self.assertNotIn('class="account-controls"', text)
