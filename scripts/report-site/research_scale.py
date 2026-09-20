"""Published training exposure, with separate units and no interpolated gains."""


def render_scale_figure(output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.ticker import FuncFormatter, NullLocator

    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "keating-training-exposure-v1"})
    ink, green, blue = "#254e63", "#00836B", "#0072B2"
    panels = [
        ("Personalization · interactions", [2, 50, 200],
         ["Keating", "SDPO: >85% style win rate", "SDPO: >95% style win rate"], [1, 10, 100, 1000]),
        ("Offline alignment · interaction tuples", [2, 50000],
         ["Keating", "SDPO: training corpus"], [1, 10, 100, 1000, 10000, 100000]),
        ("Feature rewards · optimizer steps", [1, 300, 360],
         ["Keating", "RLFR: most gains present", "RLFR: run endpoint"], [1, 10, 100, 1000]),
    ]
    fig, axes = plt.subplots(3, 1, figsize=(10, 8.2))
    for ax, (title, values, labels, ticks) in zip(axes, panels):
        ax.set_xscale("log")
        for index, (value, label) in enumerate(zip(values, labels)):
            color = green if index == 0 else blue
            ax.plot([1, value], [index, index], color=color, linewidth=2)
            ax.scatter([value], [index], color=color, s=55, zorder=3)
            ax.annotate(f"{value:,}", (value, index), xytext=(8, 0), textcoords="offset points",
                        va="center", color=ink, fontsize=10, fontweight="bold")
        ax.set_title(title, loc="left", color=ink, fontweight="bold", pad=13, fontsize=13)
        ax.set_yticks(range(len(labels)), labels, color=ink, fontsize=10)
        ax.set_ylim(len(labels) - .5, -.5)
        ax.set_xlim(.8, ticks[-1])
        ax.set_xticks(ticks)
        ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: f"{x:g}" if x < 1000 else f"{x/1000:g}k"))
        ax.xaxis.set_minor_locator(NullLocator())
        ax.grid(axis="x", color="#dce4e8", linewidth=.7)
        ax.set_axisbelow(True)
        ax.tick_params(length=0, labelcolor=ink, pad=8)
        for spine in ax.spines.values():
            spine.set_visible(False)
    fig.text(.04, .965, "The pilot tested the connection at a very small dose", fontsize=17, fontweight="bold", color=ink)
    fig.text(.04, .018, "Logarithmic axes: each tick multiplies exposure by 10. Units differ by panel.\n"
             "Published markers identify reported milestones, not a learning curve for Keating. Sources in the accompanying table.",
             fontsize=9, color="#536570")
    fig.subplots_adjust(left=.32, right=.95, top=.89, bottom=.12, hspace=.75)
    fig.savefig(output, metadata={"Date": None}, facecolor="white")
    plt.close(fig)
