"""
Backward-compatible seeding entrypoint.

This delegates to seed_images.py so sample image registration always uses the
PRD-defined pre-assigned UUIDs and section 7 data model expectations.
"""

from seed_images import ensure_sample_images_seeded


if __name__ == "__main__":
    import asyncio

    asyncio.run(ensure_sample_images_seeded())
