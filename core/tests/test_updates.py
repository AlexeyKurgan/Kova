from kova_core.api.routes.updates import _version


def test_version_comparison() -> None:
    assert _version("v1.2.3") == (1, 2, 3)
    assert _version("0.0.0") < _version("0.0.1")
    assert _version("1.10.0") > _version("1.9.9")
    assert _version("2.0.0-beta") == (2, 0, 0)
