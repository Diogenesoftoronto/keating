import marimo

__generated_with = "0.14.17"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt
    import pandas as pd

    project_root = Path(__file__).resolve().parents[1]
    analysis_path = project_root / "docs" / "generated" / "study-analysis.json"
    data = json.loads(analysis_path.read_text())

    return data, mo, pd, plt


@app.cell
def _(data, mo):
    external = data["externalEvaluation"]
    synthetic = data["syntheticBenchmark"]
    integrity = data["dataIntegrity"]

    mo.md(
        f"""
        # Keating Study Analysis

        This notebook reads the derived analysis bundle at
        `docs/generated/study-analysis.json`.

        - Raw trace files: **{integrity["rawTraceCount"]}**
        - Latest retained topic × learner pairs: **{integrity["latestTraceCount"]}**
        - Duplicate earlier traces excluded: **{integrity["excludedDuplicateTraceCount"]}**
        - Score corrections applied: **{len(external["scoreCorrections"])}**
        - External evaluation mean overall score: **{external["overall"]["mean"]}**
        - Synthetic full-suite delta over default: **{synthetic["benchmarkSummary"]["deltaOverall"]["mean"]}**
        """
    )
    return


@app.cell
def _(data, pd):
    topic_df = pd.DataFrame(data["externalEvaluation"]["topicSummary"])
    topic_df["overall_mean"] = topic_df["overall"].map(lambda row: row["mean"])
    topic_df["overall_low"] = topic_df["overall"].map(lambda row: row["ciLow"])
    topic_df["overall_high"] = topic_df["overall"].map(lambda row: row["ciHigh"])

    learner_df = pd.DataFrame(data["externalEvaluation"]["learnerSummary"])
    learner_df["overall_mean"] = learner_df["overall"].map(lambda row: row["mean"])

    ablation_df = pd.DataFrame(data["syntheticBenchmark"]["oneAtATimeAblations"])
    runs_df = pd.DataFrame(data["syntheticBenchmark"]["runs"])
    records_df = pd.DataFrame(data["externalEvaluation"]["records"])

    return ablation_df, learner_df, records_df, runs_df, topic_df


@app.cell
def _(mo, topic_df):
    mo.md("## External Evaluation by Topic")
    topic_df[["topic", "n", "overall_mean", "overall_low", "overall_high"]]
    return


@app.cell
def _(plt, topic_df):
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.barh(topic_df["topic"], topic_df["overall_mean"], color="#4E79A7")
    low = topic_df["overall_mean"] - topic_df["overall_low"]
    high = topic_df["overall_high"] - topic_df["overall_mean"]
    ax.errorbar(
        topic_df["overall_mean"],
        topic_df["topic"],
        xerr=[low, high],
        fmt="none",
        ecolor="#1F1F1F",
        capsize=3,
    )
    ax.set_xlim(0, 1)
    ax.set_xlabel("Mean overall score")
    ax.set_ylabel("")
    ax.set_title("External evaluation topic means with bootstrap intervals")
    fig.tight_layout()
    fig
    return


@app.cell
def _(mo, learner_df):
    mo.md("## External Evaluation by Learner Model")
    learner_df[["learner", "n", "overall_mean"]]
    return


@app.cell
def _(plt, runs_df):
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.hist(runs_df["deltaOverall"], bins=20, color="#59A14F", edgecolor="white")
    ax.set_xlabel("Current policy minus default policy")
    ax.set_ylabel("Seed count")
    ax.set_title("Synthetic full-suite improvement across 200 seeds")
    fig.tight_layout()
    fig
    return


@app.cell
def _(ablation_df, mo):
    mo.md("## One-at-a-Time Synthetic Ablations")
    ablation_df
    return


@app.cell
def _(plt, ablation_df):
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ordered = ablation_df.sort_values("meanDelta")
    ax.barh(ordered["field"], ordered["meanDelta"], color="#E15759")
    ax.set_xlabel("Mean delta versus default")
    ax.set_ylabel("")
    ax.set_title("Single-parameter swaps into the default policy")
    fig.tight_layout()
    fig
    return


@app.cell
def _(mo, records_df):
    mo.md("## Record-Level Audit View")
    records_df[
        [
            "topic",
            "learner",
            "overall",
            "mastery",
            "engagement",
            "clarity",
            "features",
        ]
    ]
    return


if __name__ == "__main__":
    app.run()
