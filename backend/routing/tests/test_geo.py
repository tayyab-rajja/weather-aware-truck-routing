from routing.services.geo import Place, _add_unique, _offset_vias, RawRoute


def test_offset_vias_produce_four_candidates():
    o = Place("A", -87.6, 41.8)
    d = Place("B", -83.0, 42.3)
    vias = _offset_vias(o, d)
    assert len(vias) == 4
    assert all(isinstance(v.lng, float) and isinstance(v.lat, float) for v in vias)


def test_add_unique_rejects_near_duplicates():
    bucket: list[RawRoute] = []
    a = RawRoute("1", 100, 120, [[0, 0], [1, 1]], "a")
    b = RawRoute("2", 101, 122, [[0.01, 0.01], [1.01, 1.01]], "b")
    _add_unique(bucket, a)
    _add_unique(bucket, b)
    assert len(bucket) == 1
