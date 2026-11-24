import argparse
import os

import uvicorn

from .api.server import create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="kova-core")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("KOVA_CORE_TOKEN", ""))
    args = parser.parse_args()

    os.environ["KOVA_CORE_TOKEN"] = args.token
    uvicorn.run(create_app(), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
