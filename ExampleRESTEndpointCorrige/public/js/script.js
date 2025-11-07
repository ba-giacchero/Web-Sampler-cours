window.onload = init;

function init() {
    console.log("Page loaded and script.js running");
    fetchPresets();
}

// Fetch the list of presets from the server and display them
async function fetchPresets() {
    try {
        const response = await fetch('/api/presets');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const presets = await response.json();
        displayPresets(presets);
    } catch (error) {
        console.error('Error fetching presets:', error);
    }
}

// Display the list of presets in the HTML
 function displayPresets(presets) {
    const presetList = document.querySelector('#preset-list');
    presetList.innerHTML = ''; // Clear existing list

    presets.forEach(async(preset) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${preset.name} (${preset.type})`;
        presetList.appendChild(listItem);

        // List samples for this preset if available, and add an audio player for each sample
        //showSamplesAsHTMLAudioPlayers(preset, listItem);
        await loadSamplesInMemory(preset, listItem);
    });
        
}

 // Create an AudioContext
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

async function loadSamplesInMemory(preset, presetList) {
    // Use the fetch API and the WebAudio API to load samples in memory
    // generate a button for each sample, text is sample name
    // when clicking the button, play the sample using the WebAudio API
    
    // Fisrt, compute an array with sample URLs
    if (preset.samples && preset.samples.length > 0) {
        const sampleUrls = preset.samples.map(sample => "presets/" + sample.url);
        console.log("Sample URLs:", sampleUrls);

        // Use promise.all to fetch all samples as array buffers
        Promise.all(sampleUrls.map(url => fetch(url).then(res => res.arrayBuffer())))
            .then(arrayBuffers => {
               
                // Decode all array buffers to audio buffers
                return Promise.all(arrayBuffers.map(ab => audioContext.decodeAudioData(ab)));
            })
            .then(audioBuffers => {
                console.log("Audio Buffers loaded:", audioBuffers);
                // For each audio buffer, create a button to play it
                audioBuffers.forEach((audioBuffer, index) => {
                    const sample = preset.samples[index];
                    const button = document.createElement('button');
                    button.textContent = `Play ${sample.name}`;
                    button.onclick = () => {
                        // check if audioContext is in suspended state (autoplay policy)
                        if (audioContext.state === 'suspended') {
                            audioContext.resume();
                        }
                        // Create a buffer source, connect to destination, and play
                        const source = audioContext.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioContext.destination);
                        source.start(0);
                    };
                    presetList.appendChild(button);
                });
            })
            .catch(error => {
                console.error("Error loading samples:", error);
            });
    }
}
   
            
function showSamplesAsHTMLAudioPlayers(preset, presetList) {
    if (preset.samples && preset.samples.length > 0) {
        // and an html audio player for each sample
        const sampleList = document.createElement('ul');
        preset.samples.forEach(sample => {
            const sampleItem = document.createElement('li');
            sampleItem.textContent = sample.name;

            const audioPlayer = document.createElement('audio');
            audioPlayer.controls = true;
            const source = document.createElement('source');
            source.src = "presets/" + sample.url;
            audioPlayer.appendChild(source);

            sampleItem.appendChild(audioPlayer);
            sampleList.appendChild(sampleItem);
        });
        presetList.appendChild(sampleList);
    }
}
