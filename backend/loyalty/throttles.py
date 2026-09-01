"""
loyalty/throttles.py
"""

from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle


class LeaderboardThrottle(ScopedRateThrottle):
    """
    Rate limit for the customer-facing leaderboard (scope: "leaderboard").

    `api_view` builds a fresh `WrappedAPIView` class from the view function and
    does not propagate a `throttle_scope` attribute set after decoration, so we
    pin the scope here instead of relying on `view.throttle_scope`.
    """

    def allow_request(self, request, view):
        self.scope = "leaderboard"
        self.rate = self.get_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return SimpleRateThrottle.allow_request(self, request, view)


__all__ = ["LeaderboardThrottle"]