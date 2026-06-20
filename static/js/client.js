function $(id) {
  return document.getElementById(id);
}

function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(";").shift();
}

function themeRefresh() {
  let theme = getCookie("theme") || "light";
  document.body.className = theme;
  $("toggletheme").textContent = theme == "light" ? "☀︎" : "⏾";
}

function toggleTheme() {
  let theme = getCookie("theme") || "light";
  theme = theme == "light" ? "dark" : "light";
  document.cookie = "theme=" + theme;
  themeRefresh();
}

function getBase64(file) {
  var reader = new FileReader();
  reader.readAsDataURL(file);
  return new Promise((resolve, reject) => {
    reader.onloadend = function () {
      resolve(reader.result);
    };
    reader.onerror = function (error) {
      reject("Error: ", error);
    };
  });
}

function checkMp4Signature(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result);
      // bytes 4-7 should spell "ftyp" for ISO-BMFF based formats (mp4, mov, etc.)
      const sig = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      resolve(sig === "ftyp");
    };
    reader.onerror = () => resolve(false);
    // only need the first 12 bytes
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

function uploadVideo(name, description, token, file, apiUrl = "/api/upload") {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl);

    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.setRequestHeader("X-Video-Name", name);
    xhr.setRequestHeader(
      "X-Video-Description",
      encodeURIComponent(description),
    );

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        console.log(
          `Upload progress: ${((e.loaded / e.total) * 100).toFixed(1)}%`,
        );
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));

    xhr.send(file);
  });
}

function uploadPage() {
  const nameInput = $("name");
  const descriptionInput = $("description");
  const tokenInput = $("token");
  const videoInput = $("video");
  const videoLabel = $("videolabel");
  const submitBtn = $("submitBtn");
  const videoObj = $("videoobj");

  videoInput.addEventListener("change", async () => {
    if (videoInput.files.length === 0) {
      videoLabel.textContent = "Choose a video.";
      return;
    }

    const file = videoInput.files[0];

    if (file.type !== "video/mp4") {
      videoLabel.textContent = "Please select an MP4 file.";
      videoInput.value = "";
      return;
    }

    const isMp4 = await checkMp4Signature(file);
    if (!isMp4) {
      videoLabel.textContent = "File does not appear to be a valid MP4.";
      videoInput.value = "";
      return;
    }

    videoLabel.textContent = "";
    getBase64(file).then((response) => {
      videoObj.src = response;
    });
  });

  submitBtn.addEventListener("click", () => {
    const name = nameInput.value;
    const description = descriptionInput.value;
    const token = tokenInput.value;
    const file = videoInput.files[0];

    if (!file) {
      videoLabel.textContent = "Choose a video.";
      return;
    }

    uploadVideo(name, description, token, file);
  });
}

addEventListener("DOMContentLoaded", (event) => {
  themeRefresh();
  $("toggletheme").addEventListener("click", (event) => {
    toggleTheme();
  });
});
