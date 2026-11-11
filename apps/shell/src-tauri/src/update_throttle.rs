//! When the app updater may ask GitHub's release API again. Anonymous calls
//! share 60 an hour per network address: checks fired seconds apart, each
//! retrying after a 403, used them up and logged an error per attempt (#991).
//! Standard library only, so its tests run without the Tauri toolchain.
use std::time::{Duration, Instant};

/// How long a check's answer stays the answer: an automatic check of the same
/// channel inside it reuses it. The owner's Check for updates always asks.
pub const RECENT: Duration = Duration::from_secs(5 * 60);
/// A refusal that names no time waits this long, doubled with each refusal in
/// a row. Every wait stays inside these bounds.
const FIRST_BACKOFF: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, PartialEq, Eq)]
pub enum Admit {
    /// Ask GitHub.
    Run,
    /// The last answer for this channel is recent: keep it.
    Reuse,
    /// GitHub refused the last lookup for its rate limit: wait this long more.
    Limited(Duration),
}

pub struct Throttle<C> {
    last: Option<(C, Instant)>,
    limited_until: Option<Instant>,
    refusals: u32,
}

impl<C> Default for Throttle<C> {
    fn default() -> Self { Self { last: None, limited_until: None, refusals: 0 } }
}

impl<C: Copy + PartialEq> Throttle<C> {
    /// Whether a check of `channel` goes to GitHub at `now`. `holds` says the
    /// updater still shows that channel's last answer, not a later failure or
    /// another channel. `force` is the owner asking: it always goes.
    pub fn admit(&self, channel: C, holds: bool, force: bool, now: Instant) -> Admit {
        if force { return Admit::Run; }
        if let Some(until) = self.limited_until.filter(|until| now < *until) { return Admit::Limited(until - now); }
        match self.last {
            Some((last, at)) if holds && last == channel && now.saturating_duration_since(at) < RECENT => Admit::Reuse,
            _ => Admit::Run,
        }
    }

    /// GitHub answered: the answer is reusable and any backoff ends.
    pub fn answered(&mut self, channel: C, now: Instant) {
        self.last = Some((channel, now));
        self.limited_until = None;
        self.refusals = 0;
    }

    /// The check failed for another reason: nothing to reuse, the next one asks again.
    pub fn failed(&mut self) { self.last = None; }

    /// GitHub refused for its rate limit, naming a wait or not. Returns the
    /// wait before the next automatic check.
    pub fn refused(&mut self, named: Option<Duration>, now: Instant) -> Duration {
        self.last = None;
        self.refusals = self.refusals.saturating_add(1);
        let doubled = FIRST_BACKOFF.saturating_mul(1 << self.refusals.saturating_sub(1).min(16));
        let wait = named.unwrap_or(doubled).clamp(FIRST_BACKOFF, MAX_BACKOFF);
        self.limited_until = Some(now + wait);
        wait
    }
}

/// Whether a response is GitHub's rate limit, and the wait it names. GitHub
/// answers 403 or 429: `Retry-After` in seconds for a secondary limit,
/// `X-RateLimit-Remaining: 0` with `X-RateLimit-Reset` in Unix seconds for the
/// hourly one. None for any other response; `Some(None)` names no usable time.
pub fn rate_limit(status: u16, retry_after: Option<&str>, remaining: Option<&str>, reset: Option<&str>, now_unix: u64) -> Option<Option<Duration>> {
    let seconds = |value: Option<&str>| value.and_then(|v| v.trim().parse::<u64>().ok());
    let exhausted = seconds(remaining) == Some(0);
    let retry = seconds(retry_after);
    if !(status == 429 || (status == 403 && (exhausted || retry.is_some()))) { return None; }
    if let Some(retry) = retry { return Some(Some(Duration::from_secs(retry))); }
    Some(seconds(reset).filter(|_| exhausted).map(|reset| Duration::from_secs(reset.saturating_sub(now_unix))))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_seconds_apart_reuse_the_answer_and_the_owner_still_asks() {
        let start = Instant::now();
        let mut throttle = Throttle::<u8>::default();
        assert_eq!(throttle.admit(1, false, false, start), Admit::Run);
        throttle.answered(1, start);
        // The burst of #991: a second check 1.5 s later.
        assert_eq!(throttle.admit(1, true, false, start + Duration::from_millis(1500)), Admit::Reuse);
        assert_eq!(throttle.admit(1, true, true, start + Duration::from_millis(1500)), Admit::Run);
        // Another channel, an answer replaced by a failure, or an old answer is asked again.
        assert_eq!(throttle.admit(2, true, false, start + Duration::from_secs(1)), Admit::Run);
        assert_eq!(throttle.admit(1, false, false, start + Duration::from_secs(1)), Admit::Run);
        assert_eq!(throttle.admit(1, true, false, start + RECENT), Admit::Run);
        throttle.failed();
        assert_eq!(throttle.admit(1, true, false, start + Duration::from_secs(1)), Admit::Run);
    }

    #[test]
    fn a_rate_limit_holds_automatic_checks_until_the_time_github_named() {
        let start = Instant::now();
        let mut throttle = Throttle::<u8>::default();
        assert_eq!(throttle.refused(Some(Duration::from_secs(25 * 60)), start), Duration::from_secs(25 * 60));
        assert_eq!(throttle.admit(1, false, false, start + Duration::from_secs(60)), Admit::Limited(Duration::from_secs(24 * 60)));
        assert_eq!(throttle.admit(1, false, true, start + Duration::from_secs(60)), Admit::Run);
        assert_eq!(throttle.admit(1, false, false, start + Duration::from_secs(25 * 60)), Admit::Run);
        throttle.answered(1, start + Duration::from_secs(25 * 60));
        assert_eq!(throttle.admit(2, false, false, start + Duration::from_secs(25 * 60)), Admit::Run);
    }

    #[test]
    fn a_refusal_without_a_time_backs_off_doubling_within_bounds() {
        let start = Instant::now();
        let mut throttle = Throttle::<u8>::default();
        let waits: Vec<u64> = (0..8).map(|_| throttle.refused(None, start).as_secs()).collect();
        assert_eq!(waits, [60, 120, 240, 480, 960, 1920, 3600, 3600]);
        // A named time past the hour or already reached stays inside the bounds.
        assert_eq!(throttle.refused(Some(Duration::from_secs(5 * 3600)), start).as_secs(), 3600);
        assert_eq!(throttle.refused(Some(Duration::ZERO), start).as_secs(), 60);
        throttle.answered(1, start);
        assert_eq!(throttle.refused(None, start).as_secs(), 60);
    }

    #[test]
    fn github_rate_limit_responses_name_their_wait() {
        let now = 1_794_300_000;
        let reset = (now + 1500).to_string();
        // The hourly limit of #991: 403, nothing left, reset in 25 minutes.
        assert_eq!(rate_limit(403, None, Some("0"), Some(&reset), now), Some(Some(Duration::from_secs(1500))));
        assert_eq!(rate_limit(429, None, Some("0"), Some(&reset), now), Some(Some(Duration::from_secs(1500))));
        // A secondary limit names seconds; it wins over the reset.
        assert_eq!(rate_limit(403, Some("90"), Some("0"), Some(&reset), now), Some(Some(Duration::from_secs(90))));
        assert_eq!(rate_limit(429, None, None, None, now), Some(None));
        assert_eq!(rate_limit(403, None, Some("0"), None, now), Some(None));
        // A reset already reached waits nothing more; the throttle's floor still applies.
        assert_eq!(rate_limit(403, None, Some("0"), Some("10"), now), Some(Some(Duration::ZERO)));
        // A plain 403, other statuses and remaining calls are not the rate limit.
        assert_eq!(rate_limit(403, None, Some("12"), Some(&reset), now), None);
        assert_eq!(rate_limit(403, None, None, None, now), None);
        assert_eq!(rate_limit(500, Some("90"), Some("0"), None, now), None);
        assert_eq!(rate_limit(200, None, Some("0"), Some(&reset), now), None);
    }
}
