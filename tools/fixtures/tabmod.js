/* Test module for the smoke test: uses the module hooks (tab, ＋, notifications) and family rows. Not shipped. */
export function init(app){
  return {
    tab: {icon: "🧪", label: "Test"},
    tabHtml: () => `<p id="tmBody">${app.events.filter(e => e.child === app.FAMILY).length} family rows</p>`,
    bindTab(root){ root.querySelector("#tmBody").dataset.bound = "1"; },
    fab(){ window.__tmFab = (window.__tmFab || 0) + 1; },
    notify: ["Test module", "Notices of the test module."],
    notices: () => [{key: "tm:1", text: "test module notice"}]
  };
}
