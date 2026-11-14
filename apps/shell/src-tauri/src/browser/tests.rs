use super::{checked_url, label_of, muted, profile_of, read_selection, webview2_profile, Profile, SurfaceRect, LABEL_PREFIX, MAIN_LABEL, MAX_SELECTION_CALLBACK_BYTES, PICKS};
use super::surfaces::{Placement, Surfaces};

/// A page an agent opened played its sound in the user's headset
/// (2026-10-25): its surface and its popups start muted, the user's do not.
#[test]
fn agent_surfaces_and_their_popups_are_muted_and_the_users_pages_are_not() {
    assert!(muted(&label_of("agent-1").unwrap()));
    assert!(muted("boite-popup:4:agent-1"));
    assert!(!muted(&label_of("t1").unwrap()));
    assert!(!muted(&label_of("browser:agent-1").unwrap()));
    assert!(!muted("boite-popup:5:t1"));
    assert!(!muted(MAIN_LABEL));
}

#[test]
fn an_agent_surface_out_of_sight_stays_shown_off_screen_at_its_last_size() {
    let mut surfaces = Surfaces::default();
    let agent = "boite-browser:agent-1";
    // Never measured: off screen at the default viewport, never hidden.
    assert_eq!(surfaces.placement(agent), Placement::OffScreen(1280.0, 800.0));
    let rect = SurfaceRect { x: 10.0, y: 20.0, width: 900.0, height: 600.0 };
    surfaces.place(agent, rect.clone());
    surfaces.want(agent, true);
    assert_eq!(surfaces.placement(agent), Placement::At(rect.clone()));
    // The UI parks it: it keeps its size, off screen.
    surfaces.want(agent, false);
    assert_eq!(surfaces.placement(agent), Placement::OffScreen(900.0, 600.0));
    // The window parks: the same, and its slot comes back with the window.
    surfaces.want(agent, true);
    surfaces.park();
    assert_eq!(surfaces.placement(agent), Placement::OffScreen(900.0, 600.0));
    assert_eq!(surfaces.unpark().unwrap(), [agent]);
    assert_eq!(surfaces.placement(agent), Placement::At(rect));
    surfaces.forget(agent);
    assert_eq!(surfaces.placement(agent), Placement::OffScreen(1280.0, 800.0));
}

#[test]
fn a_user_surface_is_still_hidden_when_out_of_sight() {
    let mut surfaces = Surfaces::default();
    let user = "boite-browser:browser:1";
    let rect = SurfaceRect { x: 0.0, y: 0.0, width: 10.0, height: 10.0 };
    surfaces.place(user, rect);
    assert!(surfaces.rects.is_empty());
    assert_eq!(surfaces.placement(user), Placement::Hide);
    surfaces.want(user, true);
    assert_eq!(surfaces.placement(user), Placement::Show);
    surfaces.park();
    assert_eq!(surfaces.placement(user), Placement::Hide);
    assert_eq!(surfaces.placement(MAIN_LABEL), Placement::Hide);
    // A surface id that merely contains "agent-" is not an agent surface.
    assert_eq!(surfaces.placement("boite-browser:browser:agent-1"), Placement::Hide);
}

// A page the user left in a hidden tab ran 30 minutes at 1.5 cores and
// grew to 14 GB (2026-10-17): hidden, a WebView2 still runs its scripts.
#[test]
fn a_hidden_user_page_sleeps_once_and_wakes_once_while_the_ui_and_agent_pages_never_sleep() {
    let mut surfaces = Surfaces::default();
    let user = "boite-browser:browser:1";
    assert!(surfaces.sleep(user));
    // A second hide, one per resize of a parked window, does not ask again.
    assert!(!surfaces.sleep(user));
    assert!(surfaces.wake(user));
    assert!(!surfaces.wake(user));
    assert!(surfaces.sleep(user));
    surfaces.forget(user);
    assert!(!surfaces.wake(user));
    // The UI's page hides with a parked window and keeps running; an agent page sleeps through the core.
    assert!(!surfaces.sleep(MAIN_LABEL));
    assert!(!surfaces.sleep("boite-browser:agent-1"));
}

#[test]
fn a_profile_is_the_default_the_private_session_or_a_safe_folder_name() {
    assert_eq!(profile_of("a", None), Ok(Profile::Default));
    assert_eq!(profile_of("a", Some("default")), Ok(Profile::Default));
    assert_eq!(profile_of("a", Some("private")), Ok(Profile::Private));
    assert_eq!(profile_of("a", Some("p-1a2b")), Ok(Profile::Named("p-1a2b".into())));
    for bad in ["", "-p", "P-1", "p_1", "p/1", "../x", "p 1", &"p".repeat(41)] {
        let error = profile_of("a", Some(bad)).unwrap_err();
        assert!(error.contains("lowercase letters"), "{bad:?}: {error}");
    }
}

#[test]
fn a_private_surface_runs_in_a_webview2_profile_of_its_own() {
    // A Gmail tab of the default profile was found signed out right after
    // a private tab, InPrivate on that same profile, opened beside it (2026-10-22).
    let private = webview2_profile(&Profile::Private).expect("a private surface names its own WebView2 profile");
    assert_ne!(Some(private), webview2_profile(&Profile::Default));
    // No profile id the UI or an agent can make is that name.
    assert!(profile_of("a", Some(private)).is_err(), "{private:?} is a valid profile id");
    assert_eq!(webview2_profile(&Profile::Default), None);
    assert_eq!(webview2_profile(&Profile::Named("p-1a2b".into())), Some("p-1a2b"));
}

#[test]
fn a_parked_window_shows_nothing_and_brings_back_only_the_surfaces_the_ui_wanted() {
    let mut surfaces = Surfaces::default();
    assert!(surfaces.visible(MAIN_LABEL));
    surfaces.want("boite-browser:a", true);
    surfaces.want("boite-browser:b", true);
    assert!(surfaces.visible("boite-browser:a") && surfaces.visible("boite-browser:b"));
    assert!(surfaces.park());
    // A minimized window sends resize events over and over: one park.
    assert!(!surfaces.park());
    assert!(!surfaces.visible(MAIN_LABEL) && !surfaces.visible("boite-browser:a"));
    // The UI keeps working while the window is in the tray.
    surfaces.want("boite-browser:c", true);
    assert!(!surfaces.visible("boite-browser:c"));
    surfaces.want("boite-browser:b", false);
    let mut back = surfaces.unpark().unwrap();
    back.sort();
    assert_eq!(back, ["boite-browser:a", "boite-browser:c"]);
    assert!(surfaces.unpark().is_none());
    assert!(!surfaces.visible("boite-browser:b"));
    surfaces.want("boite-browser:b", true);
    assert!(surfaces.visible("boite-browser:b") && surfaces.visible(MAIN_LABEL));
}

/// The two interleavings the review found, replayed in the order the
/// threads ran them. Each `visible` is what `reconcile` reads on the main
/// thread when the queued call runs, after every change made before it.
#[test]
fn a_late_show_or_hide_follows_the_state_it_finds_not_the_one_it_was_asked_in() {
    // (a) unpark lists b, the UI parks b, then the unpark's call runs: b
    // stays hidden.
    let mut surfaces = Surfaces::default();
    surfaces.want("boite-browser:b", true);
    surfaces.park();
    let listed = surfaces.unpark().unwrap();
    surfaces.want("boite-browser:b", false);
    assert_eq!(listed, ["boite-browser:b"]);
    assert!(!surfaces.visible("boite-browser:b"), "a surface the UI parked came back over it");
    // (b) the UI shows b, the window parks, then the show runs: b stays
    // hidden until the window comes back.
    let mut surfaces = Surfaces::default();
    surfaces.want("boite-browser:b", true);
    surfaces.park();
    assert!(!surfaces.visible("boite-browser:b"), "a surface painted in a parked window");
    surfaces.unpark();
    assert!(surfaces.visible("boite-browser:b"));
}

#[test]
fn preview_selection_is_bound_to_one_surface_and_consumed_once() {
    let id = "preview-test-one";
    PICKS.lock().unwrap().insert(id.into(), "request-1".into());
    let mut url = tauri::Url::parse("boite-preview://selection/").unwrap();
    url.query_pairs_mut().append_pair("request", "request-1").append_pair("data", r#"{"url":"https://example.test","selector":"button","text":"Save","bounds":{"x":1,"y":2,"width":30,"height":40}}"#);
    assert!(read_selection("different-view", &url).is_none());
    let selected = read_selection(id, &url).unwrap();
    assert_eq!(selected.0, "request-1");
    assert_eq!(selected.1.unwrap().text, "Save");
    assert!(read_selection(id, &url).is_none());
}

#[test]
fn preview_rejects_wrong_requests_and_invalid_content() {
    let id = "preview-test-invalid";
    PICKS.lock().unwrap().insert(id.into(), "expected".into());
    let wrong =
        tauri::Url::parse("boite-preview://selection/?request=wrong&data=null").unwrap();
    assert!(read_selection(id, &wrong).is_none());
    let mut invalid = tauri::Url::parse("boite-preview://selection/").unwrap();
    invalid.query_pairs_mut().append_pair("request", "expected").append_pair("data", r#"{"url":"file:///private","selector":"button","text":"Save","bounds":{"x":1,"y":2,"width":30,"height":40}}"#);
    assert!(read_selection(id, &invalid).unwrap().1.is_none());
    assert!(!PICKS.lock().unwrap().contains_key(id));
    PICKS.lock().unwrap().insert(id.into(), "expected".into());
    let cancel =
        tauri::Url::parse("boite-preview://selection/?request=expected&data=null").unwrap();
    assert!(read_selection(id, &cancel).unwrap().1.is_none());
}

#[test]
fn percent_encoded_selection_fits_and_oversized_callbacks_settle_once() {
    let id = "preview-test-encoding";
    let payload = serde_json::json!({
        "url": format!("https://example.test/{}", "é".repeat(8000)),
        "selector": format!("#{}", "é".repeat(1999)),
        "shadowPath": vec!["\u{0001}".repeat(4000); 8],
        "text": "é".repeat(2000),
        "bounds": { "x": 0, "y": 0, "width": 10, "height": 10 }
    });
    PICKS.lock().unwrap().insert(id.into(), "encoded".into());
    let mut url = tauri::Url::parse("boite-preview://selection/").unwrap();
    url.query_pairs_mut().append_pair("request", "encoded").append_pair("data", &payload.to_string());
    assert!(url.as_str().len() > 65536);
    assert!(url.as_str().len() < MAX_SELECTION_CALLBACK_BYTES);
    assert!(read_selection(id, &url).unwrap().1.is_some());
    PICKS.lock().unwrap().insert(id.into(), "oversized".into());
    url.set_query(None);
    url.query_pairs_mut().append_pair("request", "oversized").append_pair("data", &"x".repeat(MAX_SELECTION_CALLBACK_BYTES));
    assert!(read_selection(id, &url).unwrap().1.is_none());
    assert!(read_selection(id, &url).is_none());
}

#[test]
fn a_surface_id_becomes_a_label() {
    assert_eq!(
        label_of("browser:9f1c-2").unwrap(),
        format!("{LABEL_PREFIX}browser:9f1c-2")
    );
}

#[test]
fn an_id_a_label_cannot_carry_is_refused_by_character() {
    let error = label_of("browser:a b").unwrap_err();
    assert!(error.contains("' '"), "{error}");
    assert!(label_of("").unwrap_err().contains("empty"));
}

#[test]
fn only_http_https_and_about_are_loaded() {
    assert_eq!(checked_url("t1", "").unwrap().as_str(), "about:blank");
    assert!(checked_url("t1", "https://example.invalid/").is_ok());
    let error = checked_url("t1", "file:///C:/secret.txt").unwrap_err();
    assert!(error.contains("\"file\""), "{error}");
    assert!(error.contains("t1"), "{error}");
}
