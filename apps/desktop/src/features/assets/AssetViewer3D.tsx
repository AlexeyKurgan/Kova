import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

type Props = {
  url: string;
};

export default function AssetViewer3D({ url }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(element.clientWidth, element.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      42,
      Math.max(1, element.clientWidth) / Math.max(1, element.clientHeight),
      0.01,
      2000,
    );
    camera.position.set(2.2, 1.6, 2.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight(0xdfefff, 0x18202c, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.8);
    key.position.set(4, 7, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x9bc4ff, 1.2);
    fill.position.set(-5, 2, -3);
    scene.add(fill);

    let frame = 0;
    const animate = () => {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        scene.add(model);
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxSize = Math.max(size.x, size.y, size.z, 0.01);
        const distance =
          (maxSize / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.65;

        camera.near = Math.max(maxSize / 1000, 0.001);
        camera.far = maxSize * 100;
        camera.position.copy(
          center.clone().add(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(distance)),
        );
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.minDistance = maxSize * 0.35;
        controls.maxDistance = maxSize * 8;
        controls.update();

        const grid = new THREE.GridHelper(maxSize * 5, 10, 0x394455, 0x242c38);
        grid.position.set(center.x, box.min.y - maxSize * 0.01, center.z);
        (grid.material as THREE.Material).transparent = true;
        (grid.material as THREE.Material).opacity = 0.35;
        scene.add(grid);
        setState("ready");
      },
      undefined,
      () => {
        if (!disposed) {
          setState("error");
        }
      },
    );

    const resize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div className="asset-viewer3d">
      <div ref={host} className="asset-viewer3d-canvas" />
      {state === "loading" ? <span className="asset-viewer3d-note">Загрузка 3D…</span> : null}
      {state === "error" ? (
        <span className="asset-viewer3d-note is-error">Не удалось открыть 3D-модель</span>
      ) : null}
      {state === "ready" ? (
        <span className="asset-viewer3d-note">ЛКМ — вращать · колесо — масштаб</span>
      ) : null}
    </div>
  );
}
