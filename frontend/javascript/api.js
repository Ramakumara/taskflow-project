const BASE_URL = window.location.origin;
const socket = new WebSocket("ws://127.0.0.1:8000/ws");

socket.onopen = function () {
    console.log("WebSocket Connected");
};

socket.onmessage = function (event) {

    console.log("New Notification:", event.data);

    showNotification(event.data);
};

function showNotification(message, type = "success") {

    const notification = document.createElement("div");

    notification.className = `taskflow-notification ${type}`;

    let icon = "fa-circle-check";

    if (type === "error") {
        icon = "fa-circle-xmark";
    }

    if (type === "warning") {
        icon = "fa-triangle-exclamation";
    }

    notification.innerHTML = `
        <div class="notification-left">
            <i class="fas ${icon}"></i>
        </div>

        <div class="notification-content">
            <h4>TaskFlow Notification</h4>
            <p>${message}</p>
        </div>

        <button class="notification-close">
            <i class="fas fa-xmark"></i>
        </button>
    `;

    document.body.appendChild(notification);

    const closeBtn = notification.querySelector(".notification-close");

    closeBtn.onclick = () => {
        notification.remove();
    };

    setTimeout(() => {
        notification.classList.add("show");
    }, 100);

    setTimeout(() => {

        notification.classList.remove("show");

        setTimeout(() => {
            notification.remove();
        }, 300);

    }, 4000);
}

async function handleLogin() {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    const recaptchaToken = grecaptcha.getResponse();

    if (!recaptchaToken) {
        alert("Please complete the reCAPTCHA");
        return;
    }

    try {
        const res = await fetch(`${BASE_URL}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                email, 
                password,
                recaptcha_token: recaptchaToken
            })
        });

        const raw = await res.text();
        let data = {};

        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = { detail: raw };
        }

        if (res.ok && data.message === "Login success") {
            sessionStorage.setItem("token", data.access_token);
            sessionStorage.setItem("username", data.username || "");
            sessionStorage.setItem("email", data.email || email);
            sessionStorage.setItem("role", data.role || "user");

            if (data.role === "admin") {
                window.location.href = "/admin-page";
            } else {
                window.location.href = "/dashboard-page";
            }
            } else {
                alert(data.message || data.detail || "Login failed");
            }

            grecaptcha.reset(); 

    } catch (err) {
        console.error(err);
        alert(err?.message || "Something went wrong");
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

    const raw = await res.text();
    let data = {};

    try {
        data = raw ? JSON.parse(raw) : {};
    } catch {
        data = { detail: raw };
    }

    if (res.ok && data.message === "User registered") {
        alert("Registration successful");
        window.location.href = "/";
    } else {
        alert(data.message || data.detail || "Error registering");
    }
}


function logout() {
    sessionStorage.clear();
    window.location.href = "/";
}

async function createProject() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

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
            description: "Sample project",
            
        })
    });

    const data = await res.json().catch(() => ({}));
    const message = data?.message || (res.ok ? "Project created" : "Unable to create project");
    alert(message);
    socket.send(`New Project Created: ${name}`);
    
    document.getElementById("project-name").value = "";

    loadProjects();
    loadProjectDropdown();
}

async function loadProjects() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");
    const email = sessionStorage.getItem("email");

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
            sessionStorage.setItem("selectedProjectId", p.id);
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
    const token = sessionStorage.getItem("token");

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
    const token = sessionStorage.getItem("token");

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

    const userRoleUsers = users.filter(u => u.role === "user");

    if (userRoleUsers.length === 0) {
        select.innerHTML = "<option value=''>No registered users</option>";
        return;
    }

    userRoleUsers.forEach(u => {
        const option = document.createElement("option");
        option.value = u.email;
        option.textContent = u.email;
        select.appendChild(option);
    });

    if (select.tomselect) {
        select.tomselect.destroy();
    }

    new TomSelect("#assigned-to", {

        placeholder: "assign User",

        create: false,

        maxOptions: 1,

        allowEmptyOption: true

    });
    select.tomselect.clear();
}

async function createTask() {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

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
    socket.send(`New Task Added: ${title}`);
    document.getElementById("task-title").value = "";
    document.getElementById("assigned-to").value = "";
    document.getElementById("deadline").value = "";
    document.getElementById("project-select").value = "";


    loadProjects();
    document.getElementById("create-section").classList.add("hidden");
}

async function updateStatus(id, status) {
    const token = sessionStorage.getItem("token");

    try {
        const res = await fetch(`${BASE_URL}/tasks/${id}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + token
            },
            body: JSON.stringify({ status })
        });

        const data = await res.json();

        if (res.ok) {
            alert("Status updated to: " + status);
            socket.send(`Task Status Updated: ${status}`);
        } else {
            alert("Failed to update status");
        }

        loadProjects();

    } catch (err) {
        console.error(err);
        alert("Something went wrong");
    }
}

async function deleteProject(id) {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

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
    socket.send("Project Deleted");

    loadProjects();
}

async function deleteTask(id) {
    const token = sessionStorage.getItem("token");
    const role = sessionStorage.getItem("role");

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
    socket.send("Task Deleted");

    loadAllTasks();          // refresh tasks page
    loadProjectWorkspace();  // refresh project workspace (optional but best)
}

async function loadActivityLog() {
    const token = sessionStorage.getItem("token");
    const body = document.getElementById("activity-log-body");
    if (!body) return;

    body.innerHTML = `<tr><td colspan="4">Loading activity log...</td></tr>`;

    try {
        const res = await fetch(`${BASE_URL}/activities`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            body.innerHTML = `<tr><td colspan="4">${error.message || error.detail || "Unable to load activity log."}</td></tr>`;
            return;
        }

        const logs = await res.json();
        if (!Array.isArray(logs) || logs.length === 0) {
            body.innerHTML = `<tr><td colspan="4">No activity records found.</td></tr>`;
            return;
        }

        body.innerHTML = "";
        logs.slice(0, 30).forEach(log => {
            const timestamp = log.timestamp ? new Date(log.timestamp).toLocaleString() : "-";
            const userText = log.user_email || "-";
            const details = [log.target, log.details].filter(Boolean).join(" — ") || "-";

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${formatDateTime(log.timestamp)}</td>                
                <td>${userText}</td>
                <td>${log.action}</td>
                <td>${details}</td>
            `;
            body.appendChild(row);
        });
    } catch (err) {
        console.error(err);
        body.innerHTML = `<tr><td colspan="4">Unable to load activity log.</td></tr>`;
    }
}

async function exportActivityLog() {
    const token = sessionStorage.getItem("token");

    try {
        const res = await fetch(`${BASE_URL}/activities/export`, {
            headers: { "Authorization": "Bearer " + token }
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({}));
            alert(error.message || error.detail || "Failed to export activity log.");
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "taskflow-activity-log.csv";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
    } catch (err) {
        console.error(err);
        alert("Failed to export activity log.");
    }
}

window.onload = function () {
    const role = sessionStorage.getItem("role");
    const username = sessionStorage.getItem("username");
    const isDashboard = window.location.pathname.includes("dashboard-page");

    if (!role && isDashboard) {
        alert("Please login first");
        window.location.href = "/";
        return;
    }

    const welcome = document.getElementById("welcome-user");
    if (welcome && username) {
        welcome.innerText = username;
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
        checkAssignedTaskNotifications();
        checkTaskReminders();
    }
};

function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);

    return date.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata", 
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
    });
}

function setAvatar() {
    const email = sessionStorage.getItem("email");

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
    const profileView = document.getElementById("profile-view");
    if (profileView && typeof showView === "function" && typeof loadDashboardProfile === "function") {
        if (typeof setActiveMenu === "function") setActiveMenu("");
        showView("profile-view");
        loadDashboardProfile();
        return;
    }
    window.location.href = "/dashboard-page";
}


async function loadStatusPage() {
    const token = sessionStorage.getItem("token");

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





function loadProjectPage() {
    const projectId = sessionStorage.getItem("selectedProjectId");
    const role = sessionStorage.getItem("role"); 
    const token = sessionStorage.getItem("token"); 

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


async function checkAssignedTaskNotifications() {

    const token = sessionStorage.getItem("token");
    const email = sessionStorage.getItem("email");

    if (!token || !email) return;

    try {

        const res = await fetch(`${BASE_URL}/tasks`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const tasks = await res.json();

        if (!Array.isArray(tasks)) return;

        const assignedTasks = tasks.filter(task =>
            task.assigned_to === email
        );

        assignedTasks.forEach(task => {

            const notificationKey = `task_notification_${task.id}`;

            // Prevent duplicate popup
            if (!sessionStorage.getItem(notificationKey)) {

                showNotification(
                    `New Task Assigned: ${task.title}`,
                    "success"
                );

                sessionStorage.setItem(notificationKey, "shown");
            }

        });

    } catch (error) {

        console.error("Notification check failed", error);

    }
}

async function checkTaskReminders() {

    const token = sessionStorage.getItem("token");

    if (!token) return;

    try {

        const response = await fetch(`${BASE_URL}/tasks`, {
            headers: {
                "Authorization": "Bearer " + token
            }
        });

        const tasks = await response.json();

        const today = new Date();

        tasks.forEach(task => {

            if (!task.deadline) return;

            const deadline = new Date(task.deadline);

            const diffTime = deadline - today;

            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));



            // Tomorrow reminder
            if (diffDays === 1) {

                showNotification(
                    `Reminder: "${task.title}" deadline is tomorrow`,
                    "warning"
                );
            }



            // Due today
            if (diffDays === 0) {

                showNotification(
                    `Task "${task.title}" is due today`,
                    "warning"
                );
            }



            // Overdue
            if (diffDays < 0 && task.status !== "done") {

                showNotification(
                    `Task "${task.title}" is overdue`,
                    "error"
                );
            }

        });

    } catch (error) {

        console.error(error);
    }
}