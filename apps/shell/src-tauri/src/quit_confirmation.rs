#[derive(Debug, PartialEq, Eq)]
pub(crate) enum QuitRequest {
    Immediate,
    Awaiting(u32),
    Pending,
}

#[derive(Default)]
pub(crate) struct QuitConfirmation {
    armed: bool,
    sequence: u32,
    awaiting: Option<u32>,
}

impl QuitConfirmation {
    pub(crate) fn arm(&mut self) { self.armed = true; }

    pub(crate) fn disarm(&mut self) { self.armed = false; }

    pub(crate) fn request(&mut self) -> QuitRequest {
        if !self.armed { return QuitRequest::Immediate; }
        if self.awaiting.is_some() { return QuitRequest::Pending; }
        self.sequence = self.sequence.wrapping_add(1);
        self.awaiting = Some(self.sequence);
        QuitRequest::Awaiting(self.sequence)
    }

    /// An answer or deadline only clears the request that it belongs to.
    pub(crate) fn take(&mut self, id: u32) -> bool {
        if self.awaiting != Some(id) { return false; }
        self.awaiting = None;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_unacknowledged_current_request_expires() {
        let mut guard = QuitConfirmation::default();
        assert_eq!(guard.request(), QuitRequest::Immediate);
        guard.arm();
        assert_eq!(guard.request(), QuitRequest::Awaiting(1));
        assert_eq!(guard.request(), QuitRequest::Pending);
        assert!(guard.take(1), "the main page acknowledged the first request");
        assert_eq!(guard.request(), QuitRequest::Awaiting(2));
        assert!(!guard.take(1), "an earlier timer cannot expire a newer request");
        guard.disarm();
        assert!(guard.take(2), "a dead or reloading page never acknowledged the second request");
        assert_eq!(guard.request(), QuitRequest::Immediate);
    }
}
