const BASE_URL = "http://localhost:8000";

async function handleLogin() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    
    try {
        const res = await fetch(`${BASE_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (data.message === "Login success") {
            localStorage.setItem("token", data.access_token);
            localStorage.setItem("username", data.username || "");
            localStorage.setItem("email", data.email || email);
            localStorage.setItem("role", data.role || "user");

            if (data.role === "admin") {
                window.location.href = "/admin-page";
            } else {
                window.location.href = "/dashboard-page";
            }
        } else {
            alert(data.message);
        }

    } catch (err) {
        console.error(err);
        alert("Something went wrong");
    }
}

async function handleRegister() {
    const username = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    const role = document.getElementById("role").value;

    const res = await fetch(`${BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, role })
    });

    const data = await res.json();

    if (data.message === "User registered") {
        alert("Registration successful");
        window.location.href = "/";
    } else {
        alert("Error registering");
    }
}


function logout() {
    localStorage.clear();
    window.location.href = "/";
}

async function createProject() {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (role !== "manager") {
        alert("Only manager can create project");
        return;
    }

    const name = document.getElementById("project-name").value.trim().replace(/^./, c => c.toUpperCase());

    if(!name) {
        alert("project name is required");
        return;
    }

    const res = await fetch(`${BASE_URL}/projects`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
            name,
            description: "Sample project"
        })
    });

    const data = await res.json().catch(() => ({}));
    const message = data?.message || (res.ok ? "Project created" : "Unable to create project");
    alert(message);
    
    document.getElementById("project-name").value = "";

    loadProjects();
    loadProjectDropdown();
}

async function loadProjects() {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");
    const email = localStorage.getItem("email");

    const pres = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await pres.json();

    const tres = await fetch(`${BASE_URL}/tasks`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const tasks = await tres.json();

    const list = document.getElementById("project-grid");
    list.innerHTML = "";

    if (!list) return;

    projects.forEach(p => {

        const projectTasks = tasks.filter(t =>
            String(t.project_id) === String(p.id) &&
            (role === "manager" || role === "admin" ||
            t.assigned_to?.trim().toLowerCase() === email?.trim().toLowerCase())
        );

        if (role === "user" && projectTasks.length === 0) return;

        const card = document.createElement("div");
        card.className = "project-card-ui";

        card.innerHTML = `
            <div class="card-header"></div>
            <div class="card-body">
                <h4>${p.name}</h4>
                <p>${projectTasks.length} Tasks</p>

                ${role === "manager" ? `
                    <button class="delete-btn" onclick="event.stopPropagation(); deleteProject('${p.id}')">
                        Delete
                    </button>
                ` : ""}
            </div>
        `;

        card.onclick = () => {
            localStorage.setItem("selectedProjectId", p.id);
            showProjectWorkspace();
            if (typeof loadProjectWorkspace === "function") {
                loadProjectWorkspace();
            }
        };

        list.appendChild(card);
    });

    if (role === "manager") {
        const addCard = document.createElement("div");
        addCard.className = "project-card-ui add-card";
        addCard.innerHTML = `<h4>+ Create Project</h4>`;
        addCard.onclick = openCreate;

        list.appendChild(addCard);
    }

    if (typeof loadDashboardSummary === "function") {
        loadDashboardSummary();
    }
}

function openCreate() {
    const section = document.getElementById("create-section");

    if (!section) {
        console.error("create-section not found ");
        return;
    }

    section.classList.remove("hidden");
}

function hideCreate() {
    document.getElementById("create-section").classList.add("hidden");
}

async function loadProjectDropdown() {
    const token = localStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await res.json();

    const select = document.getElementById("project-select");
    if (!select) return;

    select.innerHTML = "<option value=''>Select Project</option>";

    projects.forEach(p => {
        const option = document.createElement("option");
        option.value = p.id;
        option.text = p.name;
        select.appendChild(option);
    });
}

async function loadUsers() {
    const token = localStorage.getItem("token");

    const res = await fetch(`${BASE_URL}/users`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const users = await res.json();

    const select = document.getElementById("assigned-to");
    if (!select) return;

    if (!Array.isArray(users)) {
        select.innerHTML = "<option value=''>No users available</option>";
        return;
    }

    select.innerHTML = "<option value=''>Assign User</option>";

    const userRoleUsers = users.filter(u => u.role === "user");

    if (userRoleUsers.length === 0) {
        select.innerHTML = "<option value=''>No registered users</option>";
        return;
    }

    userRoleUsers.forEach(u => {
        const option = document.createElement("option");
        option.value = u.email;
        option.text = u.email;
        select.appendChild(option);
    });
}

async function createTask() {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (role !== "manager") {
        alert("Only manager can create tasks");
        return;
    }

    const title = document.getElementById("task-title").value;
    const assigned_to = document.getElementById("assigned-to").value;
    const deadline = document.getElementById("deadline").value;
    const project_id = document.getElementById("project-select").value;

    if (!project_id) {
        alert("Please select a project");
        return;
    }

    if(!title) {
        alert("Task title is required");
        return;
    }

    const res = await fetch(`${BASE_URL}/tasks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
            title,
            project_id,
            assigned_to,
            status: "todo",
            deadline
        })
    });

    const data = await res.json().catch(() => ({}));
    alert(data?.message || (res.ok ? "Task created" : "Unable to create task"));
    document.getElementById("task-title").value = "";
    document.getElementById("assigned-to").value = "";
    document.getElementById("deadline").value = "";
    document.getElementById("project-select").value = "";


    loadProjects();
    document.getElementById("create-section").classList.add("hidden");
}

async function updateStatus(id, status) {
    const token = localStorage.getItem("token");

    await fetch(`${BASE_URL}/tasks/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ status })
    });

    loadProjects();
}

async function deleteProject(id) {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (role !== "manager") {
        alert("Not allowed");
        return;
    }

    if (!confirm("Delete this project?")) return;

    const res = await fetch(`${BASE_URL}/projects/${id}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const data = await res.json();
    alert(data.message);

    loadProjects();
}

async function deleteTask(id) {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");

    if (role !== "manager") {
        alert("Not allowed");
        return;
    }

    if (!confirm("Delete this task?")) return;

    const res = await fetch(`${BASE_URL}/tasks/${id}`, {
        method: "DELETE",
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    const data = await res.json();
    alert(data.message);

    loadProjectPage();
}

window.onload = function () {
    const role = localStorage.getItem("role");
    const username = localStorage.getItem("username");
    const isDashboard = window.location.pathname.includes("dashboard-page");

    if (!role && isDashboard) {
        alert("Please login first");
        window.location.href = "/";
        return;
    }

    const welcome = document.getElementById("welcome-user");
    if (welcome && username) {
        welcome.innerText = "Welcome, " + username;
    }

    if (role !== "manager") {
        const projectSection = document.getElementById("project-section");
        const taskSection = document.getElementById("task-section");
        const openCreateButtons = document.querySelectorAll(".create-btn, .sidebar-create-btn");

        if (projectSection) projectSection.style.display = "none";
        if (taskSection) taskSection.style.display = "none";
        openCreateButtons.forEach(button => {
            button.style.display = "none";
        });
    }

    if (isDashboard) {
        loadProjects();
        loadProjectDropdown();
        loadUsers();
        setAvatar();
    }
};

function setAvatar() {
    const email = localStorage.getItem("email");

    if (email) {
        const firstLetter = email.charAt(0).toUpperCase();
        const colors = ["#3498db", "#e67e22", "#9b59b6", "#1abc9c"];

        const color = colors[Math.floor(Math.random() * colors.length)];

        const avatar = document.getElementById("avatar");
        avatar.innerText = firstLetter;
        avatar.style.background = color;
    }
}

function toggleMenu() {
    const menu = document.getElementById("dropdown-menu");
    if (!menu) return;
    menu.classList.toggle("hidden");
}

window.onclick = function (e) {
    const menu = document.getElementById("dropdown-menu");
    const trigger = document.getElementById("profile-trigger");

    if (!menu) return; 

    if (!e.target.matches("#avatar") && !e.target.closest("#profile-trigger")) {
        if (!menu.classList.contains("hidden")) {
            menu.classList.add("hidden");
        }
    }
};

function goToSettings() {
    alert("Settings page coming soon!");    
}

function goToIndex() {
    alert("Index page coming soon!")
}

function goToProfile() {
    window.location.href = "/profile-page";
}

let chartInstance = null;

function renderStatusChart(tasks = []) {
    if (!Array.isArray(tasks)) {
        console.error("Invalid tasks data");
        return;
    }

    const statusCount = {
        todo: 0,
        progress: 0,
        done: 0
    };

    tasks.forEach(task => {
        switch (task.status?.toLowerCase()) {
            case "todo":
                statusCount.todo++;
                break;
            case "in progress":
                statusCount.progress++;
                break;
            case "done":
                statusCount.done++;
                break;
        }
    });

    document.getElementById("todo-count").innerText = statusCount.todo;
    document.getElementById("progress-count").innerText = statusCount.progress;
    document.getElementById("done-count").innerText = statusCount.done;

    const ctx = document.getElementById("statusChart");

    if (!ctx) {
        console.error("Canvas element not found");
        return;
    }


    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["To Do", "In Progress", "Done"],
            datasets: [{
                label: "Task Status Overview",
                data: [
                    statusCount.todo,
                    statusCount.progress,
                    statusCount.done
                ],
                backgroundColor: [
                    "#f39c12",
                    "#3498db",
                    "#2ecc71"
                ],
                borderRadius: 10,
                barThickness: 40
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false // cleaner UI
                },
                tooltip: {
                    backgroundColor: "#2c3e50",
                    titleColor: "#fff",
                    bodyColor: "#ecf0f1",
                    padding: 10,
                    cornerRadius: 6
                }
            },

            scales: {
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: "#555",
                        font: {
                            size: 13,
                            weight: "bold"
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        color: "#555"
                    },
                    grid: {
                        color: "#eee"
                    }
                }
            },

            animation: {
                duration: 1000,
                easing: "easeOutQuart"
            }
        }
    });
}

async function loadStatusPage() {
    const token = localStorage.getItem("token");

   const pres = await fetch(`${BASE_URL}/projects`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const projects = await pres.json();

    const tres = await fetch(`${BASE_URL}/tasks`, {
        headers: { "Authorization": "Bearer " + token }
    });
    const tasks = await tres.json();

    console.log("Projects:", projects);
    console.log("Tasks:", tasks);

    renderSummary(projects, tasks);
    renderProjectWiseCharts(projects, tasks);
}

function statusOverview() {
    
    window.location.href = "/status-overview-page";

}

function dashboard() {
    window.location.href = "/dashboard-page";
}

function setProjectTab(tab) {
    if (tab === "dashboard") {
        window.location.href = "/dashboard-page";
        return;
    }

    if (tab === "activity") {
        window.location.href = "/status-overview-page";
        return;
    }

    if (tab === "overview" || tab === "tasks" || tab === "team" || tab === "files") {
        window.location.href = "/project-page";
        return;
    }

    window.location.href = "/dashboard-page";
}


function renderSummary(projects, tasks) {

    const role = localStorage.getItem("role");
    const email = localStorage.getItem("email");

    let userProjects = projects;

    if (role === "user") {
        userProjects = projects.filter(p =>
            tasks.some(t =>
                String(t.project_id) === String(p.id) &&
                (t.assigned_to || "").toLowerCase().trim() === (email || "").toLowerCase().trim()
            )
        );
    }

    document.getElementById("total-projects").innerText = userProjects.length;

    document.getElementById("total-tasks").innerText = tasks.length;

    const done = tasks.filter(t => t.status === "done").length;

    const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

    document.getElementById("completion-rate").innerText = percent + "%";

    generateInsights(tasks);
}


function generateInsights(tasks) {
    const todo = tasks.filter(t => t.status === "todo").length;
    const progress = tasks.filter(t => t.status === "in progress").length;
    const done = tasks.filter(t => t.status === "done").length;

    let message = "";

    if (todo > done) {
        message = "⚠️ Many tasks are still pending. Focus on completion.";
    } else if (progress > todo) {
        message = "🚀 Good progress! Keep going.";
    } else if (done === tasks.length) {
        message = "🎉 All tasks completed!";
    } else {
        message = "📊 Work is balanced across stages.";
    }

    const insightText = document.getElementById("insight-text");
    if (insightText) {
        insightText.innerText = message;
    }
}

function renderProjectWiseCharts(projects, tasks) {
    const container = document.getElementById("project-charts");
    container.innerHTML = "";

    projects.forEach(p => {

        const projectTasks = tasks.filter(t => String(t.project_id) === String(p.id));

        if (projectTasks.length === 0) return;

        let todo = 0, progress = 0, done = 0;

        projectTasks.forEach(t => {
            if (t.status === "todo") todo++;
            else if (t.status === "in progress") progress++;
            else if (t.status === "done") done++;
        });

        const chartDiv = document.createElement("div");
        chartDiv.className = "project-chart";

        chartDiv.innerHTML = `
            <h3 style="margin-bottom: 10px;">${p.name}</h3>

            <div class="chart-row">
                
                <div class="chart-area">
                    <canvas id="chart-${p.id}"></canvas>
                </div>

                <div class="status-info">
                    <p>🟠 To Do: ${todo}</p>
                    <p>🔵 In Progress: ${progress}</p>
                    <p>🟢 Done: ${done}</p>
                </div>

            </div>
        `;

        container.appendChild(chartDiv);

        const ctx = document.getElementById(`chart-${p.id}`);

        new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: ["To Do", "In Progress", "Done"],
                datasets: [{
                    data: [todo, progress, done],
                    backgroundColor: ["#f39c12", "#3498db", "#2ecc71"]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false, 
                plugins: {
                    legend: {
                        position: "bottom"
                    }
                }
            }
        });
    });
}

function loadProjectPage() {
    const projectId = localStorage.getItem("selectedProjectId");
    const role = localStorage.getItem("role"); 
    const token = localStorage.getItem("token"); 

    if (role !== "manager") {
        const actionHeader = document.getElementById("action-header");
        if (actionHeader) actionHeader.style.display = "none";
    }
    
    
    fetch(`${BASE_URL}/projects`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    })
        .then(res => res.json())
        .then(projects => {
            const project = projects.find(p => String(p.id) === String(projectId));
            document.getElementById("project-title").innerText = project?.name || "Project";
        });


    fetch(`${BASE_URL}/tasks`, {
        headers: {
            "Authorization": "Bearer " + token
        }
    })
        .then(res => res.json())
        .then(tasks => {
            const list = document.getElementById("task-list");
            list.innerHTML = "";

            const projectTasks = tasks.filter(t =>
                String(t.project_id) === String(projectId)
            );

            if (projectTasks.length === 0) {
                list.innerHTML = `
                    <tr>
                        <td colspan="4">No tasks available</td>
                    </tr>
                `;
                return;
            }

            projectTasks.forEach(t => {
                const row = document.createElement("tr");

                row.innerHTML = `
                    <td>${t.title}</td>
                    <td>${t.assigned_to}</td>
                    <td>${t.deadline || "N/A"}</td>

                    ${
                        role === "user"
                        ? `
                        <td>
                            <select onchange="updateStatus('${t.id}', this.value)">
                                <option value="todo" ${t.status === "todo" ? "selected" : ""}>To Do</option>
                                <option value="in progress" ${t.status === "in progress" ? "selected" : ""}>In Progress</option>
                                <option value="done" ${t.status === "done" ? "selected" : ""}>Done</option>
                            </select>
                        </td>
                        `
                        : `
                        <td>
                            <span class="status ${t.status.replace(" ", "-")}">
                                ${t.status}
                            </span>
                        </td>
                        `
                    }

                    ${
                        role === "manager"
                        ? `
                        <td>
                            <button onclick="deleteTask('${t.id}')">Delete</button>
                        </td>
                        `
                        : ""
                    }
                `;

                list.appendChild(row);
            });
        });
}

function handleProjectSearch(event) {
    const searchValue = event.target.value.toLowerCase();
    const projectCards = document.querySelectorAll(".project-card-ui");
    
    projectCards.forEach(card => {
        const projectName = card.querySelector("h4")?.textContent.toLowerCase() || "";
        if (projectName.includes(searchValue)) {
            card.style.display = "";
        } else {
            card.style.display = "none";
        }
    });
}

function handleTaskSearch(event) {
    const searchValue = event.target.value.toLowerCase();
    const taskRows = document.querySelectorAll("#task-list tr");
    
    taskRows.forEach(row => {
        const taskText = row.textContent.toLowerCase();
        if (taskText.includes(searchValue)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}
