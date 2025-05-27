import logging
from typing import List, Dict, Any
from rich.table import Table
from rich.panel import Panel

logger = logging.getLogger(__name__)


def sanitize_filename(name: str) -> str:
    """Replace problematic characters with underscores."""
    chars_to_replace = [' ', '.', '(', ')', '"', '#', '!', '/', '\\']
    for ch in chars_to_replace:
        name = name.replace(ch, '_')
    return name


def normalize_designation(text: str) -> str:
    """Normalize product designation for filenames."""
    return sanitize_filename(str(text).replace(' ', '_').replace('/', '_'))


def build_live_table(client_name: str, tasks: List[Dict[str, Any]]) -> Panel:
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Tâche", justify="left", style="white")
    table.add_column("Progression", justify="center", style="cyan")
    table.add_column("Fait", justify="center", style="green")
    for t in tasks:
        is_done = t.get("ok", t.get("done", False))
        check_emoji = "✅" if is_done else "❌"
        task_name = t.get("task_name", t.get("name", "Unknown Task"))
        progress = t.get("progress", "")
        table.add_row(task_name, progress, check_emoji)
    title_str = f"[bold yellow]{client_name}[/bold yellow]"
    return Panel.fit(table, title=title_str, border_style="blue")


def set_task_progress(tasks: List[Dict[str, Any]], index: int, done: int, total: int) -> None:
    percent = (done / total) * 100 if total else 100
    tasks[index]["progress"] = f"{done}/{total} ({percent:.1f}%)"
