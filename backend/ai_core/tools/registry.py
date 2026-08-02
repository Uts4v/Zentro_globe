import json
from ..exceptions import AIToolNotFound, AIToolPermissionDenied


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, dict] = {}

    def register(self, tool_fn, name: str = "", description: str = "", parameters: dict | None = None):
        fn_name = name or tool_fn.__name__
        self._tools[fn_name] = {
            "fn": tool_fn,
            "name": fn_name,
            "description": description or tool_fn.__doc__ or "",
            "parameters": parameters or {},
        }

    def get(self, name: str) -> dict:
        tool = self._tools.get(name)
        if not tool:
            raise AIToolNotFound(f"Tool '{name}' not found")
        return tool

    def execute(self, name: str, merchant, arguments: dict) -> str:
        try:
            tool = self.get(name)
            result = tool["fn"](merchant=merchant, **arguments)
            return str(result)
        except AIToolNotFound:
            return json.dumps({"error": f"Tool '{name}' is not available. Available tools: {', '.join(self._tools.keys())}"})
        except AIToolPermissionDenied:
            raise
        except Exception as e:
            return json.dumps({"error": f"Tool '{name}' execution failed: {e}"})

    def list_definitions(self) -> list[dict]:
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "parameters": t["parameters"],
            }
            for t in self._tools.values()
        ]


tool_registry = ToolRegistry()
