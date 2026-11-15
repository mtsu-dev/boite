//! Which surfaces the UI wants on screen, whether the window is parked, and how
//! each webview is placed for it. `reconcile` applies the answer.

use super::{is_agent_label, SurfaceRect, MAIN_LABEL, OFF_SCREEN_X};
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use tauri::{LogicalPosition, LogicalSize, PhysicalPosition, Position, Rect, Size};

/// Which surfaces the UI wants on screen, and whether the window is parked.
/// WebView2 does not notice a hidden or minimized host window by itself: its
/// page keeps painting and its timers keep running until the host says so. The
/// shell says so by hiding every webview of a parked window, and has to
/// remember which surfaces to bring back, because the UI does not send a rect
/// again when it did not change.
#[derive(Default)]
pub(super) struct Surfaces {
    pub(super) shown: HashSet<String>,
    pub(super) parked: bool,
    /// The last rectangle the UI gave each agent surface, which comes back
    /// when the surface does and sizes it while it waits off screen.
    pub(super) rects: HashMap<String, SurfaceRect>,
    /// Pages the user browses that were hidden and put to sleep, so the next
    /// show gives each its normal memory level back once.
    pub(super) asleep: HashSet<String>,
}

/// The viewport an agent surface works in before the UI ever measured a slot for it.
pub(super) const AGENT_SIZE: (f64, f64) = (1280.0, 800.0);

/// What `reconcile` does to one webview.
#[derive(Debug, PartialEq)]
pub(super) enum Placement {
    Show,
    Hide,
    /// An agent surface on screen, at the slot the UI gave it.
    At(SurfaceRect),
    /// An agent surface out of sight: shown, off screen, at this logical size.
    OffScreen(f64, f64),
}

impl Surfaces {
    /// Records that the UI wants `label` shown or not. `visible` says whether
    /// it is shown now: never while the window is parked.
    pub(super) fn want(&mut self, label: &str, shown: bool) {
        if shown { self.shown.insert(label.to_owned()); } else { self.shown.remove(label); }
    }

    /// True when this call parked the window, false when it already was.
    pub(super) fn park(&mut self) -> bool {
        !std::mem::replace(&mut self.parked, true)
    }

    /// The surfaces to show again, or `None` when the window was not parked.
    pub(super) fn unpark(&mut self) -> Option<Vec<String>> {
        std::mem::replace(&mut self.parked, false).then(|| self.shown.iter().cloned().collect())
    }

    /// Whether the webview `label` belongs on screen now: the UI's page while
    /// the window is not parked, a surface while the UI also wants it.
    pub(super) fn visible(&self, label: &str) -> bool {
        !self.parked && (label == MAIN_LABEL || self.shown.contains(label))
    }

    /// Records the slot the UI gave an agent surface.
    pub(super) fn place(&mut self, label: &str, rect: SurfaceRect) {
        if is_agent_label(label) { self.rects.insert(label.to_owned(), rect); }
    }

    /// A destroyed surface's last slot goes with it.
    pub(super) fn forget(&mut self, label: &str) {
        self.shown.remove(label);
        self.rects.remove(label);
        self.asleep.remove(label);
    }

    /// True when hiding `label` should put its page to sleep now: a page the
    /// user browses, not asleep already. The UI's own page keeps running in
    /// the tray for its toasts and its connection, and an agent surface is
    /// never hidden: the core puts its page to sleep instead.
    pub(super) fn sleep(&mut self, label: &str) -> bool {
        label != MAIN_LABEL && !is_agent_label(label) && self.asleep.insert(label.to_owned())
    }

    /// True when `label` slept and is shown now: its memory level goes back to normal.
    pub(super) fn wake(&mut self, label: &str) -> bool {
        self.asleep.remove(label)
    }

    /// How the webview `label` is placed now. Hiding a WebView2 stops its page
    /// painting, which is the point for a surface the user browses, but an
    /// agent screenshots and records its surface while the user looks at
    /// another conversation, the tray, or a minimized window: a hidden one
    /// returns blank frames or none. An agent surface out of sight therefore
    /// stays shown, moved outside the window's client area at its last size.
    pub(super) fn placement(&self, label: &str) -> Placement {
        let visible = self.visible(label);
        if !is_agent_label(label) {
            return if visible { Placement::Show } else { Placement::Hide };
        }
        let rect = self.rects.get(label);
        match (visible, rect) {
            (true, Some(rect)) => Placement::At(rect.clone()),
            (true, None) => Placement::Show,
            (false, Some(rect)) => Placement::OffScreen(rect.width, rect.height),
            (false, None) => Placement::OffScreen(AGENT_SIZE.0, AGENT_SIZE.1),
        }
    }
}

/// An agent surface's bounds out of sight: off screen, at `width` by `height`.
pub(super) fn off_screen(width: f64, height: f64) -> Rect {
    Rect {
        position: Position::Physical(PhysicalPosition::new(OFF_SCREEN_X, 0)),
        size: Size::Logical(LogicalSize::new(width, height)),
    }
}

pub(super) fn bounds_of(rect: &SurfaceRect) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(rect.x, rect.y)),
        size: Size::Logical(LogicalSize::new(rect.width, rect.height)),
    }
}

static SURFACES: LazyLock<Mutex<Surfaces>> = LazyLock::new(Mutex::default);

pub(super) fn surfaces() -> std::sync::MutexGuard<'static, Surfaces> {
    SURFACES.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
