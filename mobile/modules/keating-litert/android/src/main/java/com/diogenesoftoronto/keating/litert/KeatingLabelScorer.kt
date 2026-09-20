package com.diogenesoftoronto.keating.litert

internal object KeatingLabelScorer {
  init { System.loadLibrary("keating_label_scorer") }
  external fun score(requestId: String, path: ByteArray, message: ByteArray, count: Int): FloatArray?
  external fun cancel(requestId: String)
}
