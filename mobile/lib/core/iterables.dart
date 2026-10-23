/// Small list helpers used across the app. Defined locally so no extra package is
/// needed and behaviour is obvious in review.
extension IterableHelpers<T> on Iterable<T> {
  T? get firstOrNull {
    for (final T item in this) {
      return item;
    }
    return null;
  }

  T? firstWhereOrNull(bool Function(T item) test) {
    for (final T item in this) {
      if (test(item)) return item;
    }
    return null;
  }

  /// Sum of a numeric projection.
  num sumBy(num Function(T item) pick) {
    num total = 0;
    for (final T item in this) {
      total += pick(item);
    }
    return total;
  }
}
