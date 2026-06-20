import pytest

from backend.kernel.installer import Installer
from tests.conftest import make_capability

pytestmark = pytest.mark.asyncio


async def test_install_persists_sets_verified_and_created_at(store):
    cap = make_capability(cap_id="cap-install")
    cap.verified = False
    cap.manifest.created_at = ""

    cap_id = await Installer().install(cap, store)

    assert cap_id == "cap-install"
    saved = await store.get("cap-install")
    assert saved is not None
    assert saved.verified is True
    assert saved.manifest.created_at != ""
    # Embedding written so the capability is routable (graceful-degrade vector).
    assert store._embeddings["cap-install"] == [0.0] * 1536


async def test_install_preserves_existing_created_at(store):
    cap = make_capability(cap_id="cap-keep")
    cap.manifest.created_at = "2023-01-01T00:00:00"
    await Installer().install(cap, store)
    saved = await store.get("cap-keep")
    assert saved.manifest.created_at == "2023-01-01T00:00:00"
