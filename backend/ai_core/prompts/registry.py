from ..exceptions import AIConfigurationError


class PromptRegistry:
    def __init__(self):
        self._prompts: dict[str, dict] = {}

    def register(self, name: str, version: str, prompt_def: dict):
        key = f"{name}:{version}"
        self._prompts[key] = prompt_def

    def get(self, name: str, version: str) -> dict:
        key = f"{name}:{version}"
        prompt = self._prompts.get(key)
        if not prompt:
            raise AIConfigurationError(f"Prompt '{name}' version '{version}' not found")
        return prompt

    def get_latest(self, name: str) -> dict:
        versions = []
        for key, val in self._prompts.items():
            if key.startswith(f"{name}:"):
                versions.append((key, val))
        if not versions:
            raise AIConfigurationError(f"No prompts found for '{name}'")
        versions.sort(key=lambda x: x[0], reverse=True)
        return versions[0][1]


prompt_registry = PromptRegistry()
