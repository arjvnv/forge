from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    anthropic_api_key: str
    openai_api_key: str = ""  # used only for text-embedding-3-small
    redis_url: str = "redis://localhost:6379"
    database_url: str = "postgresql://forge:forge@localhost:5432/forge"
    forge_embed_model: str = "text-embedding-3-small"
    forge_synth_model: str = "claude-opus-4-8"
    forge_route_model: str = "claude-sonnet-4-6"
    similarity_threshold: float = 0.62
    compounding_relevance_floor: float = 0.30
    compounding_top_k: int = 3
    compounding_max_logic_chars: int = 2000
    arize_api_key: str = ""
    arize_space_key: str = ""
    arize_project_name: str = "forge-eval"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
