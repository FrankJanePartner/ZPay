class NoStoreApiMiddleware:
    """Keep credentials and financial responses out of HTTP caches, including errors."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith("/api/") or request.headers.get("Authorization"):
            response["Cache-Control"] = "no-store"
        return response
