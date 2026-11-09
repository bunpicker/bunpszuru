import unittest.mock

import pytest

from szurubooru import db, model, search
from szurubooru.func import cache


def test_retrieving_from_cache():
    config = unittest.mock.MagicMock()
    with unittest.mock.patch("szurubooru.func.cache.has"), unittest.mock.patch(
        "szurubooru.func.cache.get"
    ):
        cache.has.side_effect = lambda *args: True
        cache.get.return_value = (0, None, [])
        executor = search.Executor(config)
        assert executor.execute("test:whatever", 1, 10) == (0, [])
        assert cache.get.called


def test_reloading_cached_entities_in_current_session(post_factory):
    cache.purge()
    try:
        post = post_factory(id=1)
        db.session.add(post)
        db.session.flush()
        executor = search.Executor(search.configs.PostSearchConfig())

        first_count, first_posts = executor.execute("id:1", 0, 10)
        db.session.expunge_all()
        second_count, second_posts = executor.execute("id:1", 0, 10)

        assert first_count == second_count == 1
        assert [post.post_id for post in first_posts] == [1]
        assert [post.post_id for post in second_posts] == [1]
        assert second_posts[0] is not first_posts[0]
        assert db.session.object_session(second_posts[0]) is db.session
    finally:
        cache.purge()


def test_putting_equivalent_queries_into_cache():
    config = search.configs.PostSearchConfig()
    with unittest.mock.patch("szurubooru.func.cache.has"), unittest.mock.patch(
        "szurubooru.func.cache.put"
    ):
        hashes = []

        def appender(key, _value):
            hashes.append(key)

        cache.has.side_effect = lambda *args: False
        cache.put.side_effect = appender
        executor = search.Executor(config)
        executor.execute("safety:safe test", 1, 10)
        executor.execute("safety:safe  test", 1, 10)
        executor.execute("safety:safe test ", 1, 10)
        executor.execute(" safety:safe test", 1, 10)
        executor.execute(" SAFETY:safe test", 1, 10)
        executor.execute("test safety:safe", 1, 10)
        assert len(hashes) == 6
        assert len(set(hashes)) == 1


def test_putting_non_equivalent_queries_into_cache():
    config = search.configs.PostSearchConfig()
    with unittest.mock.patch("szurubooru.func.cache.has"), unittest.mock.patch(
        "szurubooru.func.cache.put"
    ):
        hashes = []

        def appender(key, _value):
            hashes.append(key)

        cache.has.side_effect = lambda *args: False
        cache.put.side_effect = appender
        executor = search.Executor(config)
        args = [
            ("", 1, 10),
            ("creation-time:2016", 1, 10),
            ("creation-time:2015", 1, 10),
            ("creation-time:2016-01", 1, 10),
            ("creation-time:2016-02", 1, 10),
            ("creation-time:2016-01-01", 1, 10),
            ("creation-time:2016-01-02", 1, 10),
            ("tag-count:1,3", 1, 10),
            ("tag-count:1,2", 1, 10),
            ("tag-count:1", 1, 10),
            ("tag-count:1..3", 1, 10),
            ("tag-count:1..4", 1, 10),
            ("tag-count:2..3", 1, 10),
            ("tag-count:1..", 1, 10),
            ("tag-count:2..", 1, 10),
            ("tag-count:..3", 1, 10),
            ("tag-count:..4", 1, 10),
            ("-tag-count:1..3", 1, 10),
            ("-tag-count:1..4", 1, 10),
            ("-tag-count:2..3", 1, 10),
            ("-tag-count:1..", 1, 10),
            ("-tag-count:2..", 1, 10),
            ("-tag-count:..3", 1, 10),
            ("-tag-count:..4", 1, 10),
            ("safety:safe", 1, 10),
            ("safety:safe", 1, 20),
            ("safety:safe", 2, 10),
            ("safety:sketchy", 1, 10),
            ("safety:safe test", 1, 10),
            ("-safety:safe", 1, 10),
            ("-safety:safe", 1, 20),
            ("-safety:safe", 2, 10),
            ("-safety:sketchy", 1, 10),
            ("-safety:safe test", 1, 10),
            ("safety:safe -test", 1, 10),
            ("-test", 1, 10),
        ]
        for arg in args:
            executor.execute(*arg)
        assert len(hashes) == len(args)
        assert len(set(hashes)) == len(args)


@pytest.mark.parametrize(
    "input",
    [
        "special:fav",
        "special:liked",
        "special:disliked",
        "-special:fav",
        "-special:liked",
        "-special:disliked",
    ],
)
def test_putting_auth_dependent_queries_into_cache(user_factory, input):
    config = search.configs.PostSearchConfig()
    with unittest.mock.patch("szurubooru.func.cache.has"), unittest.mock.patch(
        "szurubooru.func.cache.put"
    ):
        hashes = []

        def appender(key, _value):
            hashes.append(key)

        cache.has.side_effect = lambda *args: False
        cache.put.side_effect = appender
        executor = search.Executor(config)

        executor.config.user = user_factory()
        executor.execute(input, 1, 1)
        assert len(set(hashes)) == 1

        executor.config.user = user_factory()
        executor.execute(input, 1, 1)
        assert len(set(hashes)) == 2

        executor.execute(input, 1, 1)
        assert len(set(hashes)) == 2
