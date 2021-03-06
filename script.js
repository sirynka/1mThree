import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.127/build/three.module.js'
import * as dat from 'https://cdn.jsdelivr.net/npm/dat.gui@0.7.7/build/dat.gui.module.js'
import Stats from 'https://cdn.jsdelivr.net/npm/three@0.127/examples/jsm/libs/stats.module.js'
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.127/examples/jsm/controls/OrbitControls.js'
import { firebase } from 'https://jspm.dev/@firebase/app'
import 'https://jspm.dev/@firebase/firestore'
import 'https://jspm.dev/@firebase/auth'

let renderer, scene, camera
let controls, stats
let map

const size = 128
const options = {
    color: [
        Math.floor(Math.random() * 255),
        Math.floor(Math.random() * 255),
        Math.floor(Math.random() * 255)
    ],

    drawMode: true
}

const MOUSE_BTN_LEFT = 0
const MOUSE_BTN_MIDDLE = 1
const MOUSE_BTN_RIGHT = 2

const [second, seconds] = [1000, 1000]
const [minute, minutes] = [second * 60, seconds * 60]
const [hour, hours] = [minute * 60, minutes * 60]
let lastUserAction
let listener

init()
animate()
firebaseInit()

function firebaseInit() {
    firebase.initializeApp({
        apiKey: 'AIzaSyAnnheLHtpLYwzFJNChf7f6WSMPsnC_JgQ',
        authDomain: 'mpixels-85d06.firebaseapp.com',
        databaseURL: 'https://mpixels-85d06-default-rtdb.europe-west1.firebasedatabase.app',
        projectId: 'mpixels-85d06',
        storageBucket: 'mpixels-85d06.appspot.com',
        messagingSenderId: '512956869271',
        appId: '1:512956869271:web:9a2458d5f6dda5b535d7d2',
        measurementId: 'G-BT12Z7RCP5'
    })

    const provider = new firebase.auth.GoogleAuthProvider()
    const auth = firebase.auth()

    auth.onAuthStateChanged(user => {
        if (user) return
        auth.signInWithRedirect(provider)
        auth.getRedirectResult()
    })

    const setPixelColor = doc => {
        const y = Math.floor(doc.id)
        const data = map.image.data
        const pixels = Object.entries(doc.data())
        pixels.forEach(pixel => {
            const [x, color] = pixel
            const idx = Math.floor(x) + Math.floor(y * size)
            color.forEach((byte, i) => data[idx * 3 + i] = byte)
        })
    }

    const firestore = firebase.firestore()
    firestore.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED })
    firestore.enablePersistence()

    const timestampsDoc = firestore.collection('updates').doc('timestamps')
    const pixelsCollection = firestore.collection('pixels')

    const fetchData = (source) => {
        pixelsCollection
            .get({ source })
            .then(docs => {
                docs.forEach(doc => setPixelColor(doc))
                map.needsUpdate = true
            })
    }

    const fetchUpdates = (cachedTimestamps) => {
        timestampsDoc
            .get()
            .then(doc => {
                if (!doc.exists) return
                const freshTimestamps = Object.entries(doc.data())
                freshTimestamps.forEach(entry => {
                    const [key, timestamp] = entry
                    const cachedTimestamp = cachedTimestamps[key]
                    if (cachedTimestamp && timestamp <= cachedTimestamp) return
                    pixelsCollection
                        .doc(key)
                        .get()
                        .then(doc => setPixelColor(doc))
                })
                map.needsUpdate = true
            })
    }

    timestampsDoc
        .get({ source: 'cache' })
        .then(doc => fetchUpdates(doc.data()))
        .catch(() => fetchData('default'))

    fetchData('cache')

    listener = pixelsCollection
        .onSnapshot(snapshot => {
            snapshot
                .docChanges()
                .forEach(change => setPixelColor(change.doc))
            map.needsUpdate = true
        })
}

function init() {
    renderer = new THREE.WebGLRenderer()
    renderer.setSize(window.innerWidth, window.innerHeight)
    document.body.appendChild(renderer.domElement)

    stats = new Stats()
    document.body.appendChild(stats.domElement)

    const gui = new dat.GUI()
    gui.addColor(options, 'color').listen()
    gui.add(options, 'drawMode').listen()

    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(
        - window.innerWidth / 2, + window.innerWidth / 2,
        + window.innerHeight / 2, - window.innerHeight / 2,
        0.1, 1000)

    camera.position.z = 1
    camera.zoom = 0.8 * Math.min(window.innerWidth, window.innerHeight)
    camera.updateProjectionMatrix()

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableRotate = false

    controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
    }

    const data = new Uint8Array(options.color.length * size * size)
        .map(() => 255) //Math.floor(Math.random() * 255))

    const texture = new THREE.DataTexture(data, size, size, THREE.RGBFormat)
    const geometry = new THREE.PlaneGeometry()
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)
    map = texture

    window.addEventListener('resize', onWindowResize)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    setInterval(onOneMinuteTick, 1 * minute)
    lastUserAction = Date.now()
}

function animate() {
    stats.begin()
    requestAnimationFrame(animate)
    renderer.render(scene, camera)
    stats.end()
}

function onWindowResize() {
    camera.left = - window.innerWidth / 2
    camera.right = + window.innerWidth / 2
    camera.top = - window.innerHeight / 2
    camera.bottom = + window.innerHeight / 2
    camera.zoom = 0.8 * Math.min(window.innerWidth, window.innerHeight)
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.updateProjectionMatrix()
}

function onPointerDown(event) {
    if (!options.drawMode) return

    const mouse = new THREE.Vector2(
        + (event.x / window.innerWidth) * 2 - 1,
        - (event.y / window.innerHeight) * 2 + 1)

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const [intersect] = raycaster.intersectObjects(scene.children)
    if (!intersect) return

    const point = intersect
        .point
        .addScalar(0.5)
        .multiplyScalar(size)
        .floor()

    const idx = point.x + point.y * size
    const map = intersect.object.material.map
    const data = map.image.data

    if (event.button == MOUSE_BTN_LEFT) {
        const db = firebase.firestore()

        const batch = db.batch()
        const pixelDoc = db.collection('pixels').doc(`${point.y}`)
        const updateDoc = db.collection('updates').doc('timestamps')

        batch.set(updateDoc, { [point.y]: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
        batch.set(pixelDoc, { [point.x]: options.color }, { merge: true })
        batch.commit()
    }

    if (event.button == MOUSE_BTN_RIGHT) {
        options.color = options.color.map((byte, i) => data[idx * 3 + i])
    }
}

function onPointerMove(event) {
    lastUserAction = Date.now()
}

function onOneMinuteTick() {
    if (Date.now() - lastUserAction < 1 * minute) return
    listener()
    alert("You have been disconnected due to inactivity")
    location.reload()
}